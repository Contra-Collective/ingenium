// RiftExpress: plugin system example.
//
// This file demonstrates:
//   1. Defining a plugin (function that mutates an app)
//   2. Registering it with options via `app.register(plugin, opts)`
//   3. Adding lifecycle hooks via `app.hooks.onRequest(...)`
//   4. Decorating ctx with both lazy (`decorate`) and eager (`decorateRequest`) values
//   5. Module augmentation so `ctx.user` etc. show up in TypeScript intellisense

import { riftex, RiftexUnauthorizedError, type RiftexPlugin } from 'riftexpress'

// ─── Module augmentation ──────────────────────────────────────────────────
// Any ctx properties added by `decorate` / `decorateRequest` should be
// declared here so TypeScript sees them on every handler's `ctx`.
declare module 'riftexpress' {
  interface RiftexContext {
    user: { id: string; name: string } | null
    requireAuth: () => void
    requestId: string
  }
}

// ─── The plugin ───────────────────────────────────────────────────────────
interface AuthOpts {
  secret: string
}

const authPlugin: RiftexPlugin<AuthOpts> = (app, opts) => {
  // onRequest hook: runs before middleware/handler on every request.
  // Useful for tracing, validating tokens, stamping a request ID.
  app.hooks.onRequest((ctx) => {
    const auth = ctx.headers['authorization']
    ctx.state.authValid = typeof auth === 'string' && auth === `Bearer ${opts.secret}`
  })

  // Lazy decorator: the factory only runs the first time `ctx.user` is read,
  // then the result is cached on the context for the rest of the request.
  app.decorate('user', (ctx) => {
    if (!ctx.state.authValid) return null
    return { id: 'u_demo', name: 'Demo User' }
  })

  // Lazy decorator returning a function — handy for guard helpers.
  app.decorate('requireAuth', (ctx) => () => {
    if (!ctx.state.authValid) throw new RiftexUnauthorizedError()
  })

  // Eager decorator: assigned to every ctx at the start of every request.
  // Good for cheap values (timestamps, request IDs) most handlers will read.
  app.decorateRequest('requestId', () => crypto.randomUUID())
}

// ─── Wire it up ───────────────────────────────────────────────────────────
const app = riftex()
await app.register(authPlugin, { secret: 'demo' })

app.get('/', (ctx) => ({
  hello: 'world',
  requestId: ctx.requestId,
}))

// Protected route — `requireAuth()` throws RiftexUnauthorizedError if the
// `Authorization: Bearer demo` header isn't present, which the default
// error boundary serializes as a 401 JSON response.
app.get('/me', (ctx) => {
  ctx.requireAuth()
  return { user: ctx.user, requestId: ctx.requestId }
})

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
console.log('Try:  curl -H "Authorization: Bearer demo" http://localhost:3000/me')
