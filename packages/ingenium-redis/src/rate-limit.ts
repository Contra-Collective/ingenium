import type { RateLimitStore } from 'ingenium'
import type { RedisClientLike } from './client.ts'

/**
 * Atomic fixed-window counter. INCR is atomic on its own; the `PEXPIRE`
 * piggybacks on the first hit so the window starts the moment the counter is
 * created. The trailing `PTTL` gives us the precise reset time without a
 * second round-trip and without trusting the caller's clock.
 *
 * The comment marker on line 1 is load-bearing for the in-memory fake used
 * by the test suite — see test/fake-client.ts. Real Redis ignores it.
 */
const HIT_SCRIPT = `-- INGENIUM_RATELIMIT_HIT v1
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}`

export interface RedisRateLimitStoreOptions {
  /** Connected Redis client. Caller owns lifecycle. */
  client: RedisClientLike
  /** Key prefix for every entry. Default `'ingenium:rl:'`. */
  prefix?: string
}

/**
 * Redis-backed {@link RateLimitStore}. Uses a single Lua call per hit so the
 * INCR + PEXPIRE + PTTL trio is atomic — no race where two replicas both see
 * `count == 1` and each set their own expiry, and no race where the counter
 * exists without a TTL because the expire happened in a separate round-trip
 * that lost.
 *
 * `resetAt` is computed from `PTTL` on the server side, so the value is
 * consistent across replicas even if their clocks drift. We add `Date.now()`
 * locally only to produce the absolute timestamp the rest of Ingenium
 * works with; a small clock skew there affects header reporting only, not
 * the actual rate-limit decision (which Redis owns).
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisClientLike
  private readonly prefix: string

  constructor(opts: RedisRateLimitStoreOptions) {
    this.client = opts.client
    this.prefix = opts.prefix ?? 'ingenium:rl:'
  }

  async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const result = (await this.client.eval(HIT_SCRIPT, {
      keys: [this.prefix + key],
      arguments: [String(windowMs)],
    })) as [number, number]

    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error(
        `RedisRateLimitStore: unexpected EVAL result shape: ${JSON.stringify(result)}`,
      )
    }
    const [count, ttlMs] = result
    return { count, resetAt: Date.now() + Math.max(0, ttlMs) }
  }

  async reset(key: string): Promise<void> {
    await this.client.del(this.prefix + key)
  }
}
