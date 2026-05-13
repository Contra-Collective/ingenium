import type { RateLimitStore } from './types.ts'

interface Entry {
  count: number
  resetAt: number
}

/** Default cap on the number of distinct keys held in the in-memory store. */
const DEFAULT_MAX_ENTRIES = 100_000

export interface MemoryStoreOptions {
  /**
   * Hard ceiling on the number of distinct keys retained. When exceeded, the
   * **least-recently-touched** entry is evicted to make room. Default
   * `100_000`.
   *
   * The cap exists to bound memory under adversarial conditions: an attacker
   * generating one request per unique IP would otherwise grow the map without
   * bound. With the cap, the worst case is a fixed memory footprint and
   * attackers' counters get evicted (which means they bypass rate-limiting
   * for the exact endpoint they're hammering — a real trade-off, but better
   * than OOM).
   *
   * For genuinely high-cardinality production workloads (millions of distinct
   * users), prefer a Redis-backed store so eviction isn't required.
   */
  maxEntries?: number
}

/**
 * In-process fixed-window counter store. Suitable for single-replica
 * deployments and tests; swap for a Redis-backed store when running
 * multiple replicas behind a load balancer.
 *
 * A periodic sweep removes expired entries every `windowMs` so long-lived
 * processes don't leak memory across forgotten keys. The sweep timer is
 * `.unref()`'d, so it never keeps the Node event loop alive.
 *
 * The `Map` itself is bounded by `maxEntries` (default 100k). When the cap
 * is reached, the least-recently-touched entry is evicted before the new
 * entry is inserted. We rely on the JS `Map` insertion-order guarantee:
 * delete-then-set on an existing key moves it to the end, so the first
 * iteration step always returns the genuine LRU. **This is intentional
 * defense against scanner attacks that would otherwise OOM the process by
 * generating unique keys.**
 */
export class MemoryStore implements RateLimitStore {
  private readonly map: Map<string, Entry> = new Map()
  private sweeper: NodeJS.Timeout | null = null
  private sweepIntervalMs = 0
  private readonly maxEntries: number

  constructor(opts: MemoryStoreOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError(
        `MemoryStore: maxEntries must be a positive integer, got ${String(opts.maxEntries)}`,
      )
    }
  }

  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now()
    const existing = this.map.get(key)

    let entry: Entry
    if (!existing || now >= existing.resetAt) {
      // New (or expired) key — may need to evict before inserting.
      if (!existing && this.map.size >= this.maxEntries) {
        // Evict the LRU: Map preserves insertion order, so the first key in
        // iteration is the oldest-touched (touch = delete+set on every hit).
        const oldestKey = this.map.keys().next().value
        if (oldestKey !== undefined) this.map.delete(oldestKey)
      }
      entry = { count: 1, resetAt: now + windowMs }
      // Re-insert order: existing-but-expired keys also need delete+set so
      // their order moves to the end (preserves LRU semantics).
      if (existing) this.map.delete(key)
      this.map.set(key, entry)
    } else {
      // Touch — move to end of insertion order so it's NOT the LRU candidate.
      existing.count += 1
      entry = existing
      this.map.delete(key)
      this.map.set(key, entry)
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

  /** @internal Current entry count — exposed for ops/tests. */
  get size(): number {
    return this.map.size
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
