// RiftExpress: Hello-world server.
// If you've used Express, this should look very familiar — same shape,
// just a `ctx` object instead of `(req, res)` and async-aware return values.

import { rex, gracefulShutdown, type RexMiddleware } from 'riftexpress'

const app = rex()

// Decorator: lazily attach an app start time to every ctx (read once, cached).
// Express equivalent: stash on `app.locals` and read manually in handlers.
app.decorateRequest('startedAt', () => Date.now())

// Middleware: same `(ctx, next)` pattern Koa users will recognize.
// Express equivalent: app.use((req, res, next) => { ...; next() })
const logger: RexMiddleware = async (ctx, next) => {
  await next()
  console.log(`${ctx.method} ${ctx.path} -> ${Date.now() - (ctx as any).startedAt}ms`)
}
app.use(logger)

// Static-file middleware. Drop assets in ./public and they'll be served at /.
// Express equivalent: app.use(express.static('./public'))
app.use(rex.static('./public'))

// Health check — return value is reflected to the wire as JSON.
app.use('/health', () => ({ ok: true }))

// GET / — return a value, RiftExpress reflects it to the wire as JSON/text/html.
// Express equivalent: app.get('/', (req, res) => res.send('Hello'))
app.get('/', () => 'Hello from RiftExpress')

// GET /users/:id — params are typed via the path string.
// Express equivalent: app.get('/users/:id', (req, res) => res.json({ id: req.params.id }))
app.get('/users/:id', (ctx) => ({ id: ctx.params.id }))

// POST /echo — body is lazily parsed via `ctx.body.json()` (no app.use(express.json()) needed).
// Express equivalent: app.post('/echo', (req, res) => res.json({ youSent: req.body }))
app.post('/echo', async (ctx) => {
  const payload = await ctx.body.json<Record<string, unknown>>()
  return { youSent: payload }
})

// Centralized error handler — same idea as Express's 4-arg error middleware.
app.onError((err, ctx) => {
  console.error('handler error:', err)
  ctx.json({ error: err instanceof Error ? err.message : 'unknown' }, 500)
})

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)

// Wire SIGTERM/SIGINT to a clean drain. Without this the process dies
// instantly on shutdown signals, killing in-flight requests and leaving
// keep-alive sockets dangling. Production orchestrators (Kubernetes,
// systemd, PM2, ECS, Fly, ...) all send SIGTERM before SIGKILL — this
// gives us up to `gracefulTimeoutMs` (default 10s) to finish in-flight
// work and close DB pools / flush logs in `onShutdown` before exiting.
gracefulShutdown(server, {
  onShutdown: async () => {
    // close db pools, flush logs, drain queues, etc.
  },
})
