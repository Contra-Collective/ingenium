import { RiftexUnauthorizedError } from '../errors.ts'
import type { RiftexMiddleware } from '../middleware/types.ts'
import type { RiftexContext } from '../context/context.ts'
import type {
  JwtAlgorithm,
  JwtHeader,
  JwtOptions,
  JwtSecret,
  JwtSecretResolver,
  JwtTokenReader,
  JwtVerified,
} from './types.ts'
import { verifyJwt } from './verify.ts'

const DEFAULT_ALGORITHMS: readonly JwtAlgorithm[] = ['HS256']
const SUPPORTED: ReadonlySet<JwtAlgorithm> = new Set(['HS256', 'HS384', 'HS512'])

/** Default token reader — `Authorization: Bearer <token>`. */
const defaultGetToken: JwtTokenReader = (ctx) => {
  const raw = ctx.headers['authorization']
  if (!raw) return undefined
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return undefined
  // Bearer scheme is case-insensitive per RFC 6750 §2.1.
  const space = value.indexOf(' ')
  if (space < 0) return undefined
  const scheme = value.slice(0, space)
  if (scheme.toLowerCase() !== 'bearer') return undefined
  const token = value.slice(space + 1).trim()
  return token.length > 0 ? token : undefined
}

/**
 * Bearer-token JWT verification middleware.
 *
 * Attaches the verified token at `ctx.jwt`. Callers should module-augment
 * `RiftexContext` for typed access (the framework purposely doesn't ship a
 * baked-in `jwt` field — payload shape is application-specific):
 *
 * @example
 * ```ts
 * declare module 'riftexpress' {
 *   interface RiftexContext {
 *     jwt?: import('riftexpress').JwtVerified<{ sub: string; roles: string[] }>
 *   }
 * }
 *
 * import { riftex } from 'riftexpress'
 * const app = riftex()
 * app.use(riftex.jwt({ secret: process.env.JWT_SECRET! }))
 * app.get('/me', (ctx) => ({ sub: ctx.jwt!.payload.sub }))
 * ```
 *
 * Security choices:
 * - Default leeway (`clockSkewSeconds`) is **5 seconds** — enough for typical
 *   multi-host clock drift, small enough that an expired token does not stay
 *   usable for long.
 * - Signature comparison uses `crypto.timingSafeEqual` after an explicit
 *   length check inside {@link verifyJwt}.
 * - Only HMAC algorithms (HS256/HS384/HS512) are supported in v0.0.1; asking
 *   for RS\* / ES\* throws at construction.
 * - The wire-facing error is always `RiftexUnauthorizedError('Invalid token')`
 *   regardless of which check failed (signature vs exp vs aud) — this avoids
 *   handing attackers an oracle. Detailed reasons go to `opts.logger` (or
 *   `process.emitWarning` if no logger is supplied).
 */
export function jwtMiddleware<T = Record<string, unknown>>(
  opts: JwtOptions<T>,
): RiftexMiddleware {
  // ── Construction-time validation ─────────────────────────────────────────
  if (opts == null || (opts.secret as unknown) === undefined || opts.secret === null) {
    throw new Error('jwtMiddleware: `secret` is required')
  }

  const algorithms = (opts.algorithms ?? DEFAULT_ALGORITHMS).slice() as JwtAlgorithm[]
  if (algorithms.length === 0) {
    throw new Error('jwtMiddleware: `algorithms` must contain at least one algorithm')
  }
  for (const alg of algorithms) {
    if (!SUPPORTED.has(alg)) {
      // Strict v0.0.1 message — keep wording stable for downstream tests.
      // Cast to widen: callers may pass any string, the JwtAlgorithm union is
      // an interface contract not a runtime guarantee.
      const wide = alg as unknown as string
      if (wide.startsWith('RS') || wide.startsWith('ES') || wide.startsWith('PS') || wide.startsWith('Ed')) {
        throw new Error(`${wide} not supported in v0.0.1; pin to an HSxxx algorithm`)
      }
      throw new Error(`jwtMiddleware: unsupported algorithm ${wide}`)
    }
  }

  const required = opts.required ?? true
  const clockSkewSeconds = opts.clockSkewSeconds ?? 5
  const getToken = opts.getToken ?? defaultGetToken
  const logger = opts.logger ?? ((event) => {
    process.emitWarning(`jwt verification failed: ${event.reason}`, 'RiftexJwtWarning')
  })

  const staticSecrets = resolveStaticSecrets(opts.secret)
  const secretResolver = typeof opts.secret === 'function' ? (opts.secret as JwtSecretResolver) : null

  return async (ctx, next) => {
    const token = await getToken(ctx)
    if (!token) {
      if (required) {
        // Missing token IS allowed to leak (it's not an oracle — no secret material involved).
        throw new RiftexUnauthorizedError('Missing token')
      }
      await next()
      return
    }

    // Resolve secrets per-request when a function was supplied.
    let secrets: readonly string[]
    if (secretResolver) {
      // Peek at the header so the resolver can route by `kid`. If the header
      // is unparseable we still let the verifier produce the canonical error.
      const peeked = peekHeader(token)
      try {
        const resolved = await secretResolver(peeked ?? ({ alg: '' } as JwtHeader))
        if (typeof resolved !== 'string' || resolved.length === 0) {
          logger({ reason: 'secret_resolver_returned_empty' })
          throw new RiftexUnauthorizedError('Invalid token')
        }
        secrets = [resolved]
      } catch (err) {
        if (err instanceof RiftexUnauthorizedError) throw err
        logger({ reason: 'secret_resolver_threw' })
        throw new RiftexUnauthorizedError('Invalid token')
      }
    } else {
      secrets = staticSecrets
    }

    // Build VerifyOptions without spreading undefined keys (exactOptionalPropertyTypes).
    const verifyOpts: Parameters<typeof verifyJwt>[2] = { algorithms, clockSkewSeconds }
    if (opts.audience !== undefined) verifyOpts.audience = opts.audience
    if (opts.issuer !== undefined) verifyOpts.issuer = opts.issuer
    if (opts.maxAgeSeconds !== undefined) verifyOpts.maxAgeSeconds = opts.maxAgeSeconds
    const result = verifyJwt<T>(token, secrets, verifyOpts)

    if ('error' in result) {
      logger({ reason: result.error })
      throw new RiftexUnauthorizedError('Invalid token')
    }

    ;(ctx as RiftexContext & { jwt?: JwtVerified<T> }).jwt = result
    await next()
  }
}

/** Normalize string / string[] secrets to a flat readonly array. */
function resolveStaticSecrets(secret: JwtSecret): readonly string[] {
  if (typeof secret === 'function') return []
  if (typeof secret === 'string') {
    if (secret.length === 0) {
      throw new Error('jwtMiddleware: `secret` must be a non-empty string')
    }
    return [secret]
  }
  if (Array.isArray(secret)) {
    if (secret.length === 0) {
      throw new Error('jwtMiddleware: `secret` array must contain at least one secret')
    }
    for (const s of secret) {
      if (typeof s !== 'string' || s.length === 0) {
        throw new Error('jwtMiddleware: every secret in the array must be a non-empty string')
      }
    }
    return secret.slice()
  }
  throw new Error('jwtMiddleware: `secret` must be a string, string[], or function')
}

/** Best-effort header peek for resolver routing. Returns null on malformed tokens. */
function peekHeader(token: string): JwtHeader | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  try {
    const buf = Buffer.from(token.slice(0, dot), 'base64url')
    if (buf.length === 0) return null
    const parsed = JSON.parse(buf.toString('utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed as JwtHeader
  } catch {
    return null
  }
}
