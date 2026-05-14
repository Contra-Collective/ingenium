// ─────────────────────────────────────────────────────────────────────────────
//  Step 3 — Middleware and `ctx.state`.
//
//  Concepts:
//    • Middleware = `(ctx, next) => …` — same Koa-style sandwich pattern:
//      do work, `await next()`, do more work.
//    • `ctx.state` is per-request scratch space. Earlier middleware can write
//      to it; later middleware and handlers can read it.
//    • Middleware registered with `app.use(path, mw)` only runs on that path.
//
//  Run:        npm run 3
//  Try it:     curl -i http://localhost:3000/
//              curl -i http://localhost:3000/admin/secret    # admin-only mw
// ─────────────────────────────────────────────────────────────────────────────

import { riftex } from 'riftexpress'

const app = riftex()

app.use(async (ctx, next) => {
  ctx.state.startedAt = Date.now()
  await next()
  const ms = Date.now() - (ctx.state.startedAt as number)
  console.log(`${ctx.method} ${ctx.path} ${ms}ms`)
})

app.use('/admin', async (ctx, next) => {
  if (ctx.headers.authorization !== 'Bearer admin') {
    return ctx.json({ error: 'unauthorized' }, 401)
  }
  await next()
})

app.get('/', () => 'public')
app.get('/admin/secret', () => ({ password: 'hunter2' }))

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
