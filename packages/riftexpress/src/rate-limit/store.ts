import type { RateLimitStore } from './types.ts'

interface Entry {
  count: number
  resetAt: number
}

/**
 * In-process fixed-window counter store. Suitable for single-replica
 * deployments and tests; swap for a Redis-backed store when running
 * multiple replicas behind a load balancer.
 *
 * A periodic sweep removes expired entries every `windowMs` so long-lived
 * processes don't leak memory across forgotten keys. The sweep timer is
 * `.unref()`'d, so it never keeps the Node event loop alive.
 */
export class MemoryStore implements RateLimitStore {
  private readonly map: Map<string, Entry> = new Map()
  private sweeper: NodeJS.Timeout | null = null
  private sweepIntervalMs = 0

  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now()
    const existing = this.map.get(key)

    let entry: Entry
    if (!existing || now >= existing.resetAt) {
      entry = { count: 1, resetAt: now + windowMs }
      this.map.set(key, entry)
    } else {
      existing.count += 1
      entry = existing
    }

    this.ensureSweeper(windowMs)
    return Promise.resolve({ count: entry.count, resetAt: entry.resetAt })
  }

  reset(key: string): Promise<void> {
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

  private ensureSweeper(windowMs: number): void {
    if (this.sweeper && this.sweepIntervalMs === windowMs) return
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweepIntervalMs = windowMs
    this.sweeper = setInterval(() => this.sweep(), windowMs)
    if (typeof this.sweeper.unref === 'function') this.sweeper.unref()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.map) {
      if (now >= entry.resetAt) this.map.delete(key)
    }
  }
}
