import type { SessionStore } from './types.ts'

interface Entry {
  data: Record<string, unknown>
  expiresAt: number
}

/**
 * In-process session store backed by a `Map`. Suitable for development and
 * single-instance deployments. NOT shared across workers/replicas.
 *
 * Expired entries are evicted lazily on access AND periodically by a
 * background sweep. The sweep timer is `unref()`'d so it never keeps the
 * Node process alive on its own.
 */
export class MemoryStore implements SessionStore {
  private readonly map = new Map<string, Entry>()
  private readonly sweep: NodeJS.Timeout | null

  /**
   * @param sweepIntervalMs How often to scan the map for expired entries.
   * Defaults to 60s. Pass `0` to disable the timer entirely (tests).
   */
  constructor(sweepIntervalMs = 60_000) {
    if (sweepIntervalMs > 0) {
      this.sweep = setInterval(() => this.purge(), sweepIntervalMs)
      // Don't keep the event loop alive just for the sweep.
      this.sweep.unref?.()
    } else {
      this.sweep = null
    }
  }

  async get(id: string): Promise<Record<string, unknown> | null> {
    const entry = this.map.get(id)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(id)
      return null
    }
    return entry.data
  }

  async set(id: string, data: Record<string, unknown>, ttlSeconds: number): Promise<void> {
    this.map.set(id, { data, expiresAt: Date.now() + ttlSeconds * 1000 })
  }

  async destroy(id: string): Promise<void> {
    this.map.delete(id)
  }

  async touch(id: string, ttlSeconds: number): Promise<void> {
    const entry = this.map.get(id)
    if (!entry) return
    entry.expiresAt = Date.now() + ttlSeconds * 1000
  }

  /**
   * Stop the background sweep timer. Useful in tests / graceful shutdown.
   * After this call the store still works but expired entries are only
   * evicted on access.
   */
  stop(): void {
    if (this.sweep) clearInterval(this.sweep)
  }

  /** @internal Test helper: number of live (non-expired) entries. */
  size(): number {
    this.purge()
    return this.map.size
  }

  private purge(): void {
    const now = Date.now()
    for (const [id, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(id)
    }
  }
}
