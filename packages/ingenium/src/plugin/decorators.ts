import type { IngeniumContext } from '../context/context.ts'
import type { Decorator, EagerDecorator, LazyDecorator } from './types.ts'

interface LazyEntry {
  name: string
  factory: LazyDecorator
}

interface EagerEntry {
  name: string
  factory: EagerDecorator
}

/**
 * Per-app registry of decorators. Decorators are NOT installed onto
 * `IngeniumContext.prototype` — that would mutate a shared class and leak across
 * apps in the same process. Instead, `applyTo(ctx)` writes them onto each
 * pooled context instance at request start.
 *
 * # Lazy vs eager — perf trade-off
 *
 * - **Lazy** (`decorate`): installed via `Object.defineProperty` with a
 *   getter. The getter computes on first access, then redefines itself as
 *   a plain data property holding the resolved value (define-self pattern).
 *   Subsequent reads cost a normal property access — no getter call. Use
 *   this for values that may not be needed (e.g. `ctx.user` on public
 *   routes), and for values whose computation is non-trivial (DB lookups,
 *   token decoding).
 *
 * - **Eager** (`decorateRequest`): factory is invoked at request start,
 *   value assigned directly. Use this for cheap values that virtually every
 *   handler will read (e.g. `ctx.startedAt = Date.now()`). Avoids the
 *   per-property getter-redefinition overhead.
 *
 * # Pool reuse
 *
 * Pooled contexts are reset between requests; the `IngeniumContext.reset()`
 * method does not know about decorator names, so each request re-applies
 * via `applyTo(ctx)`. Lazy `defineProperty` overwrites the previous slot
 * configuration cleanly; eager assignment overwrites the previous value.
 * No leakage between requests.
 */
export class DecoratorRegistry {
  private readonly lazy: LazyEntry[] = []
  private readonly eager: EagerEntry[] = []

  /** Register a lazy decorator. Computed on first access; cached thereafter. */
  decorate<T>(name: string, factory: LazyDecorator<T>): void {
    this.lazy.push({ name, factory: factory as Decorator })
  }

  /** Register an eager decorator. Factory runs at the start of every request. */
  decorateRequest<T>(name: string, factory: EagerDecorator<T>): void {
    this.eager.push({ name, factory: factory as Decorator })
  }

  /** True when any decorator is registered (lets the hot path skip work). */
  hasAny(): boolean {
    return this.lazy.length > 0 || this.eager.length > 0
  }

  /**
   * Install all registered decorators onto a single context instance.
   * Called by `app.handle` after `onRequest` hooks and before dispatch.
   */
  applyTo(ctx: IngeniumContext): void {
    // Eager: simple assignment.
    for (let i = 0; i < this.eager.length; i++) {
      const entry = this.eager[i]!
      ;(ctx as unknown as Record<string, unknown>)[entry.name] = entry.factory(ctx)
    }
    // Lazy: define-self getter.
    for (let i = 0; i < this.lazy.length; i++) {
      const entry = this.lazy[i]!
      defineLazy(ctx, entry.name, entry.factory)
    }
  }
}

/**
 * Install a getter that computes once, then replaces itself with a plain
 * data property holding the resolved value. After first access, reads are
 * free of any getter overhead.
 */
function defineLazy(ctx: IngeniumContext, name: string, factory: LazyDecorator): void {
  Object.defineProperty(ctx, name, {
    configurable: true,
    enumerable: true,
    get() {
      const value = factory(ctx)
      Object.defineProperty(ctx, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      })
      return value
    },
  })
}
