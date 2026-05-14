import type { RedisClientLike, RedisSetOptions } from '../src/client.ts'

interface Entry {
  value: string
  /** absolute ms; Infinity = no expiry */
  expiresAt: number
}

/**
 * In-memory stand-in for node-redis used by the test suite. Implements the
 * subset of commands the three stores actually call, including a tiny
 * dispatcher for our rate-limit Lua script that emulates INCR + PEXPIRE +
 * PTTL atomically (atomicity here is free because the fake is single-threaded
 * within the test process).
 *
 * Deliberately NOT exported from the package — keep it test-only so we don't
 * accidentally suggest it as a production fallback.
 */
export class FakeRedisClient implements RedisClientLike {
  private readonly store = new Map<string, Entry>()
  /** Test hook: lets us advance "Redis time" without real timers. */
  now = (): number => Date.now()

  private expired(entry: Entry): boolean {
    return entry.expiresAt !== Infinity && this.now() >= entry.expiresAt
  }

  private read(key: string): Entry | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (this.expired(entry)) {
      this.store.delete(key)
      return null
    }
    return entry
  }

  get(key: string): Promise<string | null> {
    const entry = this.read(key)
    return Promise.resolve(entry?.value ?? null)
  }

  set(key: string, value: string, options?: RedisSetOptions): Promise<string | null> {
    if (options?.NX && this.read(key) !== null) return Promise.resolve(null)
    let expiresAt = Infinity
    if (options?.EX !== undefined) expiresAt = this.now() + options.EX * 1000
    if (options?.PX !== undefined) expiresAt = this.now() + options.PX
    this.store.set(key, { value, expiresAt })
    return Promise.resolve('OK')
  }

  del(key: string | readonly string[]): Promise<number> {
    const keys = typeof key === 'string' ? [key] : key
    let deleted = 0
    for (const k of keys) if (this.store.delete(k)) deleted += 1
    return Promise.resolve(deleted)
  }

  expire(key: string, seconds: number): Promise<boolean | number> {
    const entry = this.read(key)
    if (!entry) return Promise.resolve(0)
    entry.expiresAt = this.now() + seconds * 1000
    return Promise.resolve(1)
  }

  eval(
    script: string,
    options: { keys: readonly string[]; arguments: readonly string[] },
  ): Promise<unknown> {
    if (script.includes('RIFTEX_RATELIMIT_HIT')) {
      return Promise.resolve(this.runRateLimitHit(options.keys, options.arguments))
    }
    throw new Error(`FakeRedisClient: unrecognized EVAL script:\n${script}`)
  }

  private runRateLimitHit(
    keys: readonly string[],
    args: readonly string[],
  ): [number, number] {
    const key = keys[0]
    const windowMs = Number(args[0])
    if (key === undefined || !Number.isFinite(windowMs)) {
      throw new Error('FakeRedisClient: bad RATELIMIT_HIT invocation')
    }

    const now = this.now()
    let entry = this.store.get(key)
    if (entry && this.expired(entry)) {
      this.store.delete(key)
      entry = undefined
    }

    let count: number
    if (!entry) {
      count = 1
      this.store.set(key, { value: '1', expiresAt: now + windowMs })
    } else {
      count = Number(entry.value) + 1
      entry.value = String(count)
    }

    const refreshed = this.store.get(key)!
    const ttl =
      refreshed.expiresAt === Infinity
        ? -1
        : Math.max(0, refreshed.expiresAt - now)
    return [count, ttl]
  }
}
