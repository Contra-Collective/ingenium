import type { SessionStore } from 'riftexpress'
import type { RedisClientLike } from './client.ts'

export interface RedisSessionStoreOptions {
  /** Connected Redis client. Caller owns lifecycle. */
  client: RedisClientLike
  /** Key prefix for every entry. Default `'riftex:sess:'`. */
  prefix?: string
}

/**
 * Redis-backed {@link SessionStore}. JSON-encodes session data and uses
 * `SET ... EX` so Redis owns TTL expiry — no sweeper, no clock drift between
 * the cookie expiry and the stored value.
 *
 * The store does NOT manage the client connection. Create + `.connect()` your
 * `createClient(...)` before constructing the store; close it during your
 * graceful shutdown hook.
 */
export class RedisSessionStore implements SessionStore {
  private readonly client: RedisClientLike
  private readonly prefix: string

  constructor(opts: RedisSessionStoreOptions) {
    this.client = opts.client
    this.prefix = opts.prefix ?? 'riftex:sess:'
  }

  async get(id: string): Promise<Record<string, unknown> | null> {
    const raw = await this.client.get(this.prefix + id)
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }

  async set(id: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void> {
    await this.client.set(this.prefix + id, JSON.stringify(data), { EX: ttlSeconds })
  }

  async destroy(id: string): Promise<void> {
    await this.client.del(this.prefix + id)
  }

  async touch(id: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(this.prefix + id, ttlSeconds)
  }
}
