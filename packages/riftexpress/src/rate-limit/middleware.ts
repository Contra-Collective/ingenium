import type { RexContext } from '../context/context.ts'
import type { RexMiddleware } from '../middleware/types.ts'
import { MemoryStore } from './store.ts'
import type { RateLimitOptions } from './types.ts'

/** Default key generator — see RateLimitOptions.keyGenerator JSDoc. */
function defaultKeyGenerator(ctx: RexContext): string {
  const xff = ctx.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]
    const trimmed = first?.trim()
    if (trimmed && trimmed.length > 0) return trimmed
  }
  const xri = ctx.headers['x-real-ip']
  if (typeof xri === 'string' && xri.length > 0) return xri
  return 'unknown'
}

/**
 * Fixed-window rate-limiting middleware. Each key is allowed at most `max`
 * requests per `windowMs`. Over-limit requests get a `429 Too Many
 * Requests` response with `Retry-After` and a JSON body.
 *
 * Every passing response carries `X-RateLimit-Limit`,
 * `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (unix seconds).
 *
 * @example
 *   app.use(rateLimit({ max: 100, windowMs: 60_000 }))
 *   app.use('/auth', rateLimit({ max: 5, windowMs: 60_000 }))
 */
export function rateLimit(opts: RateLimitOptions = {}): RexMiddleware {
  const windowMs = opts.windowMs ?? 60_000
  const max = opts.max ?? 100
  const keyGenerator = opts.keyGenerator ?? defaultKeyGenerator
  const skip = opts.skip
  const store = opts.store ?? new MemoryStore()

  if (windowMs <= 0) throw new Error('rateLimit: windowMs must be > 0')
  if (max <= 0) throw new Error('rateLimit: max must be > 0')

  return async (ctx, next) => {
    if (skip && skip(ctx)) {
      return next()
    }

    const key = keyGenerator(ctx)
    const { count, resetAt } = await store.hit(key, windowMs)

    const remaining = Math.max(0, max - count)
    const resetSeconds = Math.ceil(resetAt / 1000)

    ctx.set('x-ratelimit-limit', String(max))
    ctx.set('x-ratelimit-remaining', String(remaining))
    ctx.set('x-ratelimit-reset', String(resetSeconds))

    if (count > max) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
      ctx.set('retry-after', String(retryAfter))
      ctx.json(
        {
          error: 'Too Many Requests',
          code: 'RATE_LIMITED',
          retryAfter,
        },
        429,
      )
      return
    }

    return next()
  }
}
