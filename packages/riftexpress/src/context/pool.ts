import { RiftexContext } from './context.ts'

/**
 * A bounded free-list of `RiftexContext` objects. Acquire on each request,
 * release back when the response has been written. If the pool is empty,
 * a fresh context is allocated; if the pool is full on release, the
 * context is discarded (GC handles it). Never blocks.
 */
export class RiftexContextPool {
  private readonly pool: RiftexContext[] = []
  private readonly max: number

  constructor(maxSize = 1024) {
    this.max = maxSize
  }

  /** Acquire a context. Caller must call `release()` when done. */
  acquire(): RiftexContext {
    return this.pool.pop() ?? new RiftexContext()
  }

  /** Reset and return the context to the free list (or discard if full). */
  release(ctx: RiftexContext): void {
    ctx.reset()
    if (this.pool.length < this.max) this.pool.push(ctx)
  }

  /** Current free-list size. Useful for tests and metrics. */
  get size(): number {
    return this.pool.length
  }
}
