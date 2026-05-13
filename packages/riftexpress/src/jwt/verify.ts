import { createHmac, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import type {
  JwtAlgorithm,
  JwtHeader,
  JwtVerified,
  JwtVerifyError,
} from './types.ts'

/** node:crypto digest names for the supported HMAC algorithms. */
const ALG_TO_DIGEST: Readonly<Record<JwtAlgorithm, string>> = {
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
}

/** Options accepted by {@link verifyJwt}. Mirrors the relevant subset of `JwtOptions`. */
export interface VerifyOptions {
  algorithms: readonly JwtAlgorithm[]
  audience?: string | readonly string[]
  issuer?: string | readonly string[]
  maxAgeSeconds?: number
  clockSkewSeconds?: number
  /** Override "now" for deterministic tests. Returns seconds since epoch. */
  nowSeconds?: () => number
}

/**
 * Decode a base64url-encoded JSON segment. Returns `null` on malformed input
 * (so callers can fold it into the generic `'malformed'` failure mode).
 */
function decodeJsonSegment<T = unknown>(segment: string): T | null {
  if (!segment) return null
  try {
    const buf = Buffer.from(segment, 'base64url')
    if (buf.length === 0) return null
    const parsed = JSON.parse(buf.toString('utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed as T
  } catch {
    return null
  }
}

/**
 * Constant-time HMAC verification.
 *
 * `timingSafeEqual` requires equal-length buffers — feeding mismatched lengths
 * would itself leak length info via the throw. So we compare `signingInput`'s
 * computed signature against the supplied one only after the explicit length
 * check; both branches return `false` in O(constant) time relative to the
 * caller's view (the throw path never executes).
 */
function hmacVerifies(alg: JwtAlgorithm, secret: string, signingInput: string, sigB64: string): boolean {
  const expected = createHmac(ALG_TO_DIGEST[alg], secret).update(signingInput).digest()
  let actual: Buffer
  try {
    actual = Buffer.from(sigB64, 'base64url')
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/** Allowed claim resolution — both single value and array forms are common in spec. */
function audienceMatches(claim: unknown, expected: string | readonly string[]): boolean {
  const wanted = typeof expected === 'string' ? [expected] : expected
  if (typeof claim === 'string') return wanted.includes(claim)
  if (Array.isArray(claim)) {
    for (const c of claim) {
      if (typeof c === 'string' && wanted.includes(c)) return true
    }
  }
  return false
}

function issuerMatches(claim: unknown, expected: string | readonly string[]): boolean {
  if (typeof claim !== 'string') return false
  return typeof expected === 'string' ? expected === claim : expected.includes(claim)
}

/**
 * Pure JWT verifier. No I/O, no logging — returns either a `JwtVerified` or
 * a tagged failure object. The middleware layer is responsible for collapsing
 * every failure into the same `RiftexUnauthorizedError('Invalid token')` so
 * the wire never reveals which check tripped.
 *
 * `secrets` is a flat array because secret-resolution (rotation, kid-lookup)
 * is the caller's responsibility; this function just tries them in order.
 */
export function verifyJwt<T = Record<string, unknown>>(
  token: string,
  secrets: readonly string[],
  opts: VerifyOptions,
): JwtVerified<T> | JwtVerifyError {
  if (typeof token !== 'string' || token.length === 0) return { error: 'malformed' }

  // Compact serialization: header.payload.signature
  const firstDot = token.indexOf('.')
  if (firstDot <= 0) return { error: 'malformed' }
  const secondDot = token.indexOf('.', firstDot + 1)
  if (secondDot <= firstDot + 1 || secondDot === token.length - 1) return { error: 'malformed' }
  if (token.indexOf('.', secondDot + 1) !== -1) return { error: 'malformed' }

  const headerB64 = token.slice(0, firstDot)
  const payloadB64 = token.slice(firstDot + 1, secondDot)
  const sigB64 = token.slice(secondDot + 1)

  const header = decodeJsonSegment<JwtHeader>(headerB64)
  if (!header || typeof header.alg !== 'string') return { error: 'malformed' }

  const alg = header.alg as JwtAlgorithm
  if (!opts.algorithms.includes(alg)) return { error: 'unsupported_alg' }
  // Defensive: `alg` must be one we can actually compute, even if the
  // allowlist somehow contained a typo.
  if (!Object.prototype.hasOwnProperty.call(ALG_TO_DIGEST, alg)) {
    return { error: 'unsupported_alg' }
  }

  const payload = decodeJsonSegment<T & Record<string, unknown>>(payloadB64)
  if (!payload) return { error: 'malformed' }

  const signingInput = `${headerB64}.${payloadB64}`

  // Try each candidate secret. We don't short-circuit on the first valid
  // length match — secrets[] is small and bounded by the user.
  let signatureOk = false
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue
    if (hmacVerifies(alg, secret, signingInput, sigB64)) {
      signatureOk = true
      break
    }
  }
  if (!signatureOk) return { error: 'bad_signature' }

  // Temporal claims.
  const now = (opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))()
  const skew = opts.clockSkewSeconds ?? 5
  const claims = payload as Record<string, unknown>

  if (typeof claims.exp === 'number') {
    if (claims.exp <= now - skew) return { error: 'expired' }
  }
  if (typeof claims.nbf === 'number') {
    if (claims.nbf > now + skew) return { error: 'not_yet_valid' }
  }
  if (typeof opts.maxAgeSeconds === 'number') {
    if (typeof claims.iat !== 'number') return { error: 'too_old' }
    if (claims.iat + opts.maxAgeSeconds <= now - skew) return { error: 'too_old' }
  }
  if (opts.audience !== undefined) {
    if (!audienceMatches(claims.aud, opts.audience)) return { error: 'aud_mismatch' }
  }
  if (opts.issuer !== undefined) {
    if (!issuerMatches(claims.iss, opts.issuer)) return { error: 'iss_mismatch' }
  }

  return { header, payload, raw: token }
}

/** Internal helper — exported for tests that want a stable digest map. */
export function digestFor(alg: JwtAlgorithm): string {
  return ALG_TO_DIGEST[alg]
}
