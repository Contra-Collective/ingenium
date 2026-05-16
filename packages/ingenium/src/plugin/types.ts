import type { IngeniumApp } from '../app.ts'
import type { IngeniumContext } from '../context/context.ts'
import type { HttpMethod } from '../router/types.ts'

/**
 * Payload fired to `onRoute` hooks each time a route is registered into the
 * trie during composition. Plugins can observe — they MUST NOT mutate.
 */
export interface RegistrationEvent {
  /** HTTP method (uppercase). */
  readonly method: HttpMethod
  /** Final composed route path (after all prefixes). */
  readonly path: string
}

/**
 * A plugin is a function that mutates an app: it can register routes,
 * middleware, decorators, and hook handlers. Plugins are registered before
 * `compose()` runs; they may be async.
 *
 * @example
 * const myPlugin: IngeniumPlugin<{ secret: string }> = async (app, opts) => {
 *   app.hooks.onRequest((ctx) => { ... })
 *   app.decorate('user', (ctx) => loadUser(ctx, opts.secret))
 * }
 *
 * await app.register(myPlugin, { secret: 'shh' })
 */
export type IngeniumPlugin<O = void> = (app: IngeniumApp, opts: O) => void | Promise<void>

/** Fires once per route as the trie is built (during `compose()`). */
export type OnRouteHook = (registration: RegistrationEvent) => void

/** Fires before composition runs. May be async. */
export type OnComposeHook = () => void | Promise<void>

/** Fires at the start of every request, before middleware dispatch. */
export type OnRequestHook = (ctx: IngeniumContext) => void | Promise<void>

/** Fires after the handler resolves successfully. */
export type OnResponseHook = (ctx: IngeniumContext) => void | Promise<void>

/**
 * Fires when the handler chain throws. OBSERVATION ONLY — the framework's
 * error boundary still owns the response. Throwing inside an `onError` hook
 * is swallowed; this is by design so observers can't mask the original error.
 */
export type OnErrorHook = (err: unknown, ctx: IngeniumContext) => void | Promise<void>

/**
 * Public hooks API exposed on `app.hooks`. Each method appends a listener;
 * listeners are invoked in registration order, sequentially (`await`-ed in
 * a loop) for predictable ordering.
 */
export interface Hooks {
  onRoute(fn: OnRouteHook): void
  onCompose(fn: OnComposeHook): void
  onRequest(fn: OnRequestHook): void
  onResponse(fn: OnResponseHook): void
  onError(fn: OnErrorHook): void
}

/** Lazy decorator — computed on first access, then cached on the ctx. */
export type LazyDecorator<T = unknown> = (ctx: IngeniumContext) => T

/** Eager decorator — evaluated at request start, value assigned directly. */
export type EagerDecorator<T = unknown> = (ctx: IngeniumContext) => T

/** Generic decorator factory shape (covers both lazy and eager). */
export type Decorator<T = unknown> = (ctx: IngeniumContext) => T
