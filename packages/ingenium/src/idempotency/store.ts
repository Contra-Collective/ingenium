import type { CachedResponse, IdempotencyStore } from './types.ts'

interface Entry {
  value: CachedResponse
  expiresAt: number
}

/**
 * In-process idempotency cache. Suitable for single-replica deployments and
 * tests; back with Redis when running multiple replicas behind a load
 * balancer (responses cached on one replica won't replay on another).
 *
 * A periodic sweep removes expired entries so long-lived processes don't
 * leak memory across forgotten keys. The sweep timer is `.unref()`'d, so
 * it never keeps the Node event loop alive.
 */
export class IdempotencyMemoryStore implements IdempotencyStore {
  private readonly map: Map<string, Entry> = new Map()
  private sweeper: NodeJS.Timeout | null = null
  private sweepIntervalMs = 0

  get(key: string): Promise<CachedResponse | null> {
    const entry = this.map.get(key)
    if (!entry) return Promise.resolve(null)
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(key)
      return Promise.resolve(null)
    }
    return Promise.resolve(entry.value)
  }

  set(key: string, value: CachedResponse, ttlMs: number): Promise<void> {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs })
    this.ensureSweeper(ttlMs)
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.map.delete(key)
    return Promise.resolve()
  }

  /**
   * Stop the cleanup interval. Safe to call multiple times. Mostly useful
   * in tests; production usage doesn't need this because the timer is
   * already unref'd.
   */
  destroy(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper)
      this.sweeper = null
    }
    this.map.clear()
  }

  private ensureSweeper(ttlMs: number): void {
    if (this.sweeper && this.sweepIntervalMs === ttlMs) return
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweepIntervalMs = ttlMs
    this.sweeper = setInterval(() => this.sweep(), ttlMs)
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.map) {
      if (now >= entry.expiresAt) this.map.delete(key)
    }
  }
}
