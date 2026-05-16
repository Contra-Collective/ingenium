import type { IngeniumContext } from '../context/context.ts'

/**
 * Pluggable backing store for the rate-limit middleware. The default
 * in-memory implementation is sync internally but exposes a Promise-based
 * surface so a Redis (or other distributed) store can drop in unchanged.
 */
export interface RateLimitStore {
  /**
   * Record a hit for `key`. Returns the new count and the unix-millis
   * timestamp at which the current window expires.
   *
   * Implementations MUST roll the window over when `Date.now() >= resetAt`,
   * resetting the count to 1.
   */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>

  /** Clear the counter for `key`. Used by tests and by ops tooling. */
  reset(key: string): Promise<void>
}

/**
 * Options for {@link rateLimit}.
 */
export interface RateLimitOptions {
  /**
   * Window length in milliseconds. Default: `60_000` (one minute).
   *
   * Each key is allowed at most `max` requests per window. Counts reset
   * sharply at window boundaries (fixed-window algorithm).
   */
  windowMs?: number

  /** Max requests per `windowMs` per key. Default: `100`. */
  max?: number

  /**
   * Build the limiter key for a request. Default uses `X-Forwarded-For`
   * (first hop), then `X-Real-IP`, then the literal string `'unknown'`.
   *
   * **Security**: the default trusts `X-Forwarded-For` blindly. Without
   * an upstream that strips client-supplied values, this header is
   * forgeable. Production deployments behind a proxy should validate the
   * proxy chain or supply a custom `keyGenerator`.
   */
  keyGenerator?: (ctx: IngeniumContext) => string

  /**
   * Skip rate-limiting for a given request. When this returns `true`, no
   * counter hit is recorded and no `X-RateLimit-*` headers are written.
   * Default: never skip.
   */
  skip?: (ctx: IngeniumContext) => boolean

  /**
   * Backing store. Default: an in-process {@link MemoryStore}. Swap in a
   * shared store (Redis etc.) when running multiple replicas.
   */
  store?: RateLimitStore
}
