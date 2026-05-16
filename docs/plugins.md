# Plugins

Ingenium ships a minimal plugin system: a plugin is a function that mutates
an app, and plugins compose via lifecycle hooks and per-request decorators.

## Plugin signature

```ts
type IngeniumPlugin<O = void> = (app: IngeniumApp, opts: O) => void | Promise<void>

await app.register(myPlugin, opts)   // when the plugin requires options
await app.register(myPlugin)         // when the plugin takes no options
```

Plugins are invoked immediately and may be async. Register them BEFORE the
first request — registering after composition sets the dirty bit and forces a
recompose on the next request.

## Lifecycle order

For a single request, hooks fire in this fixed order:

```
onCompose            (once, before the first request after a registration)
onRoute              (per route, during compose)
  ── per request ──
onRequest            (sequential, in registration order)
[decorators applied]
[middleware + handler]
onResponse           (only on success)
onError              (only on throw — observation only; boundary still writes)
```

`onError` is **observation only**. The framework's error boundary owns the
response; throws inside an `onError` listener are swallowed so observers can't
mask the original error.

## decorate vs decorateRequest — cost

```ts
app.decorate('user', (ctx) => loadUser(ctx))         // lazy
app.decorateRequest('startedAt', () => Date.now())   // eager
```

- `decorate(name, fn)` installs a self-replacing getter via `Object.defineProperty`.
  The factory runs the **first time** `ctx[name]` is read; the getter then
  redefines itself as a plain data property. Subsequent reads cost nothing extra.
  Use this when the value is expensive (DB lookups) or might never be read on
  some routes.

- `decorateRequest(name, fn)` runs the factory at the start of **every** request
  and assigns the value directly. Use this for cheap values that nearly every
  handler reads (timestamps, request IDs).

When no plugins, hooks, or decorators are registered, the framework skips the
plugin path entirely (`hasAny()` short-circuits) — zero overhead on the hot path.

## Module augmentation pattern

To make decorated values appear in TypeScript intellisense:

```ts
declare module 'ingenium' {
  interface IngeniumContext {
    user: User
    requireAuth: () => void
  }
}
```

## Example: auth plugin

```ts
import type { IngeniumPlugin } from 'ingenium'
import { IngeniumUnauthorizedError } from 'ingenium'

interface AuthOpts { token: string; user: User }

export const authPlugin: IngeniumPlugin<AuthOpts> = (app, opts) => {
  app.hooks.onRequest((ctx) => {
    ctx.state.authValid = ctx.headers.authorization === `Bearer ${opts.token}`
  })

  app.decorate('user', (ctx) => ctx.state.authValid ? opts.user : null)

  app.decorate('requireAuth', (ctx) => () => {
    if (!ctx.state.authValid) throw new IngeniumUnauthorizedError()
  })
}

// Usage
await app.register(authPlugin, { token: process.env.TOKEN!, user })
app.get('/me', (ctx) => {
  ctx.requireAuth()
  ctx.json({ user: ctx.user })
})
```
