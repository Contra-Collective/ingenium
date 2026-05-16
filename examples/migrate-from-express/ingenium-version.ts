// Ingenium version — the "after" snapshot.
// Run with: npm run ingenium   (listens on http://localhost:3002)
//
// Compare line-by-line with express-version.ts: same routes, same shapes,
// same status codes. The only intentional behavioral change is that
// handlers may RETURN a value instead of calling res.json/res.send.

import {
  ingenium,
  Router,
  gracefulShutdown,
  type IngeniumMiddleware,
} from 'ingenium'

const app = ingenium()

// JSON body parsing — accepted as a no-op for migration ergonomics.
// Body is actually parsed lazily via `ctx.body.json()` inside the handler.
app.use(ingenium.json())

// Logger middleware.
const logger: IngeniumMiddleware = async (ctx, next) => {
  const start = Date.now()
  await next()
  console.log(`${ctx.method} ${ctx.path} -> ${Date.now() - start}ms`)
}
app.use(logger)

// In-memory store so POST /users has somewhere to write.
const users = new Map<string, { id: string; name: string }>()

app.get('/users/:id', (ctx) => {
  const user = users.get(ctx.params.id)
  if (!user) {
    ctx.json({ error: 'not found' }, 404)
    return
  }
  ctx.json(user)
})

app.post('/users', async (ctx) => {
  const body = await ctx.body.json<{ id?: unknown; name?: unknown }>()
  if (typeof body?.id !== 'string' || typeof body?.name !== 'string') {
    ctx.json({ error: 'id and name must be strings' }, 400)
    return
  }
  const user = { id: body.id, name: body.name }
  users.set(user.id, user)
  ctx.json(user, 201)
})

// Sub-router mounted at /api with a health endpoint.
const api = Router()
api.get('/health', (ctx) => {
  ctx.json({ ok: true })
})
app.use('/api', api)

// Custom error handler — replaces Express's 4-arg middleware idiom.
app.onError((err, ctx) => {
  console.error('handler error:', err)
  ctx.json(
    { error: err instanceof Error ? err.message : 'unknown' },
    500,
  )
})

const server = await app.listen(3002)
console.log(`Ingenium listening on http://localhost:${server.port}`)

// Graceful shutdown — the Express equivalent is "nothing": Express drops
// dead on SIGTERM, killing in-flight requests. Ingenium ships a small
// helper that drains the server, runs your cleanup hook, and then exits.
// Default timeout is 10s; a second signal during shutdown forces exit(1).
gracefulShutdown(server, {
  onShutdown: async () => {
    // close db pools, flush logs, drain queues, etc.
  },
})
