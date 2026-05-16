import type { IngeniumMiddleware } from '../middleware/types.ts'
import type { IngeniumContext } from '../context/context.ts'
import type { CorsOptions, CorsOrigin } from './types.ts'

const DEFAULT_METHODS: readonly string[] = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
]

/**
 * Append a value to the `Vary` response header, de-duplicating field names
 * (case-insensitive).
 */
function appendVary(ctx: IngeniumContext, field: string): void {
  const existing = ctx.getHeader('vary')
  if (!existing) {
    ctx.set('vary', field)
    return
  }
  const cur = Array.isArray(existing) ? existing.join(', ') : existing
  const seen = cur
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  if (seen.includes(field.toLowerCase())) return
  ctx.set('vary', cur.length > 0 ? `${cur}, ${field}` : field)
}

/**
 * Resolve the `origin` option against the request's `Origin` header.
 * Returns the literal value to put on `Access-Control-Allow-Origin`, or
 * `null` to omit the header (request is denied / had no `Origin`).
 *
 * Also returns `reflected` — `true` when the value mirrors the request's
 * `Origin`, so the caller knows to add `Vary: Origin`.
 */
async function resolveOrigin(
  spec: CorsOrigin,
  reqOrigin: string | undefined,
  ctx: IngeniumContext,
): Promise<{ value: string | null; reflected: boolean }> {
  // Static wildcard: never depends on the request, never reflects.
  if (spec === '*') return { value: '*', reflected: false }
  if (spec === false) return { value: null, reflected: false }

  // Anything below requires an Origin header on the request.
  if (typeof reqOrigin !== 'string' || reqOrigin.length === 0) {
    return { value: null, reflected: false }
  }

  if (spec === true) return { value: reqOrigin, reflected: true }

  if (typeof spec === 'string') {
    return spec === reqOrigin
      ? { value: reqOrigin, reflected: true }
      : { value: null, reflected: true }
  }

  if (Array.isArray(spec)) {
    return spec.includes(reqOrigin)
      ? { value: reqOrigin, reflected: true }
      : { value: null, reflected: true }
  }

  if (spec instanceof RegExp) {
    return spec.test(reqOrigin)
      ? { value: reqOrigin, reflected: true }
      : { value: null, reflected: true }
  }

  if (typeof spec === 'function') {
    const result = await spec(reqOrigin, ctx)
    if (result === true) return { value: reqOrigin, reflected: true }
    if (result === false) return { value: null, reflected: true }
    if (typeof result === 'string') {
      // Custom string — not a literal reflection; only Vary if it's not '*'.
      return { value: result, reflected: result !== '*' }
    }
    return { value: null, reflected: true }
  }

  return { value: null, reflected: false }
}

/**
 * CORS middleware. Implements the standard CORS protocol (Fetch spec
 * §3.2.4) for both simple requests and preflight (`OPTIONS` +
 * `Access-Control-Request-Method`).
 *
 * @example
 *   app.use(ingenium.cors())
 *   app.use(ingenium.cors({ origin: ['https://app.example.com'], credentials: true }))
 */
export function corsMiddleware(opts: CorsOptions = {}): IngeniumMiddleware {
  const origin: CorsOrigin = opts.origin ?? '*'
  const methods = opts.methods ?? DEFAULT_METHODS
  const allowedHeaders = opts.allowedHeaders
  const exposedHeaders = opts.exposedHeaders
  const credentials = opts.credentials ?? false
  const maxAge = opts.maxAge
  const optionsSuccessStatus = opts.optionsSuccessStatus ?? 204

  // Construction-time validation: `credentials: true` + wildcard origin is
  // forbidden by the CORS spec — browsers reject the response.
  if (credentials && origin === '*') {
    throw new Error(
      "ingenium.cors: `credentials: true` is incompatible with `origin: '*'`. " +
        'Specify an explicit origin (string, array, regex, or function) instead.',
    )
  }

  const methodsHeader = methods.join(',')
  const exposedHeader = exposedHeaders && exposedHeaders.length > 0
    ? exposedHeaders.join(',')
    : undefined
  const allowedHeader = allowedHeaders && allowedHeaders.length > 0
    ? allowedHeaders.join(',')
    : undefined
  const maxAgeHeader = typeof maxAge === 'number' ? String(maxAge) : undefined

  return async (ctx, next) => {
    const reqOrigin = ctx.headers.origin
    const reqOriginStr = typeof reqOrigin === 'string' ? reqOrigin : undefined

    const { value: allowOrigin, reflected } = await resolveOrigin(
      origin,
      reqOriginStr,
      ctx,
    )

    if (reflected) appendVary(ctx, 'Origin')

    if (allowOrigin !== null) {
      ctx.set('access-control-allow-origin', allowOrigin)
      if (credentials) {
        ctx.set('access-control-allow-credentials', 'true')
      }
    }

    // Detect preflight: OPTIONS + Access-Control-Request-Method header.
    const acrm = ctx.headers['access-control-request-method']
    const isPreflight =
      ctx.method === 'OPTIONS' && typeof acrm === 'string' && acrm.length > 0

    if (isPreflight) {
      ctx.set('access-control-allow-methods', methodsHeader)

      if (allowedHeader !== undefined) {
        ctx.set('access-control-allow-headers', allowedHeader)
      } else {
        const acrh = ctx.headers['access-control-request-headers']
        if (typeof acrh === 'string' && acrh.length > 0) {
          ctx.set('access-control-allow-headers', acrh)
          // The reflected headers vary with the request, so signal it.
          appendVary(ctx, 'Access-Control-Request-Headers')
        }
      }

      if (maxAgeHeader !== undefined) {
        ctx.set('access-control-max-age', maxAgeHeader)
      }

      // Preflight terminates here — no body, no downstream handlers.
      ctx.status(optionsSuccessStatus)
      ctx.set('content-length', '0')
      ctx._body = { kind: 'none' }
      ctx._written = true
      return
    }

    // Simple / actual request: expose headers, then continue the chain.
    if (exposedHeader !== undefined) {
      ctx.set('access-control-expose-headers', exposedHeader)
    }

    return next()
  }
}
