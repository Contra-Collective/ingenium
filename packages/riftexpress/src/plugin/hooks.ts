import type { RexContext } from '../context/context.ts'
import type {
  Hooks,
  OnComposeHook,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  OnRouteHook,
  RegistrationEvent,
} from './types.ts'

/**
 * Registry for the framework's lifecycle hooks. Implements the `Hooks`
 * interface that plugins call into via `app.hooks`.
 *
 * # Execution model
 *
 * `runOn*` methods invoke listeners **sequentially** in registration order,
 * awaiting each one before invoking the next. This is intentional:
 *
 *   - Predictable ordering: a hook registered first ALWAYS observes state
 *     before a hook registered later. Plugins can rely on this.
 *   - Backpressure: an async hook (e.g. fetching a session) blocks
 *     subsequent hooks, ensuring downstream hooks see decorated state.
 *   - Errors short-circuit `runOnRequest`/`runOnResponse`/`runOnCompose` —
 *     they propagate to the caller (the request enters the error boundary).
 *
 * `runOnError` is the exception: it wraps each listener in a try/catch and
 * swallows throws, because observers must not mask the original error.
 *
 * # Reading order
 *
 * Within a single `run*` call, listeners run in the order they were added.
 * Across hook types within one request, the order is fixed by `app.handle`:
 *
 *   onRequest -> (decorators applied) -> dispatch -> onResponse
 *                                                 \-> onError (on throw)
 *
 * # Hot-path note
 *
 * Each `runOn*` returns immediately if no listeners are registered. Callers
 * should additionally check `hasAny()` (or the per-hook `has*()` helpers) to
 * skip the `await` entirely on the zero-plugin path.
 */
export class HooksRegistry implements Hooks {
  private readonly _onRoute: OnRouteHook[] = []
  private readonly _onCompose: OnComposeHook[] = []
  private readonly _onRequest: OnRequestHook[] = []
  private readonly _onResponse: OnResponseHook[] = []
  private readonly _onError: OnErrorHook[] = []

  // ───── Registration (Hooks interface) ──────────────────────────────────

  onRoute(fn: OnRouteHook): void { this._onRoute.push(fn) }
  onCompose(fn: OnComposeHook): void { this._onCompose.push(fn) }
  onRequest(fn: OnRequestHook): void { this._onRequest.push(fn) }
  onResponse(fn: OnResponseHook): void { this._onResponse.push(fn) }
  onError(fn: OnErrorHook): void { this._onError.push(fn) }

  // ───── Hot-path checks ─────────────────────────────────────────────────

  /** True when any request-time hook is registered. */
  hasAny(): boolean {
    return (
      this._onRequest.length > 0 ||
      this._onResponse.length > 0 ||
      this._onError.length > 0
    )
  }

  hasOnRequest(): boolean { return this._onRequest.length > 0 }
  hasOnResponse(): boolean { return this._onResponse.length > 0 }
  hasOnError(): boolean { return this._onError.length > 0 }
  hasOnRoute(): boolean { return this._onRoute.length > 0 }
  hasOnCompose(): boolean { return this._onCompose.length > 0 }

  // ───── Run (sequential, registration order) ────────────────────────────

  /** Synchronous — `onRoute` is invoked during composition for each route. */
  runOnRoute(event: RegistrationEvent): void {
    for (let i = 0; i < this._onRoute.length; i++) {
      this._onRoute[i]!(event)
    }
  }

  async runOnCompose(): Promise<void> {
    for (let i = 0; i < this._onCompose.length; i++) {
      await this._onCompose[i]!()
    }
  }

  async runOnRequest(ctx: RexContext): Promise<void> {
    for (let i = 0; i < this._onRequest.length; i++) {
      await this._onRequest[i]!(ctx)
    }
  }

  async runOnResponse(ctx: RexContext): Promise<void> {
    for (let i = 0; i < this._onResponse.length; i++) {
      await this._onResponse[i]!(ctx)
    }
  }

  /** Observation only. Throws inside listeners are swallowed. */
  async runOnError(err: unknown, ctx: RexContext): Promise<void> {
    for (let i = 0; i < this._onError.length; i++) {
      try {
        await this._onError[i]!(err, ctx)
      } catch {
        // Swallow — observers must not mask the original error.
      }
    }
  }
}
