// ─────────────────────────────────────────────────────────────────────────────
//  Step 8 — Sessions.
//
//  Concepts:
//    • `sessionMiddleware` reads / writes a signed cookie and attaches
//      `ctx.session` for stateful per-user data.
//    • Call `ctx.session.regenerate()` after privilege changes (e.g. login)
//      to mint a fresh id — defends against session-fixation attacks.
//    • The default store is in-memory and single-process only. For
//      multi-replica deployments swap in `RedisSessionStore` from the
//      `riftexpress-redis` package — same API, different `store:` option.
//
//  Run:        npm run 8
//  Try it:     curl -i -c jar -X POST http://localhost:3000/login \
//                -H 'content-type: application/json' \
//                -d '{"user":"ada"}'
//              curl -b jar http://localhost:3000/me
//              curl -b jar -X POST http://localhost:3000/logout
//              curl -b jar http://localhost:3000/me            # session gone
// ─────────────────────────────────────────────────────────────────────────────

import { riftex, sessionMiddleware, type Session } from 'riftexpress'

declare module 'riftexpress' {
  interface RiftexContext {
    session: Session
  }
}

const app = riftex()

app.use(sessionMiddleware({
  secret: ['dev-secret-rotate-me'],
  cookie: { sameSite: 'lax' },
}))

app.post('/login', async (ctx) => {
  const { user } = await ctx.body.json<{ user: string }>()
  await ctx.session.regenerate()
  ctx.session.set('user', user)
  return { ok: true }
})

app.get('/me', (ctx) => ({ user: ctx.session.get('user') ?? null }))

app.post('/logout', async (ctx) => {
  await ctx.session.destroy()
  return { ok: true }
})

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
