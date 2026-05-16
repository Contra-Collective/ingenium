// ─────────────────────────────────────────────────────────────────────────────
//  Step 7 — Plugins and decorators.
//
//  Concepts:
//    • A plugin is `(app, opts) => …` — a function that registers stuff onto
//      the app. Compose features without polluting the global app surface.
//    • `app.decorate(name, fn)` attaches a lazy getter to every `ctx`. The
//      function runs the first time the property is read on a given request
//      and the result is cached for the rest of that request.
//    • `declare module 'ingenium'` opts you into typed access to your
//      decoration (`ctx.user` is fully typed below).
//
//  Run:        npm run 7
//  Try it:     curl http://localhost:3000/me                                # 401
//              curl -H 'authorization: Bearer let-me-in' \
//                http://localhost:3000/me                                   # 200
// ─────────────────────────────────────────────────────────────────────────────

import {
  ingenium,
  IngeniumUnauthorizedError,
  type IngeniumPlugin,
} from 'ingenium'

interface User {
  id: string
  email: string
}

declare module 'ingenium' {
  interface IngeniumContext {
    user: User
  }
}

const auth: IngeniumPlugin<{ token: string }> = (app, opts) => {
  app.decorate('user', (ctx) => {
    const header = ctx.headers.authorization ?? ''
    if (header !== `Bearer ${opts.token}`) {
      throw new IngeniumUnauthorizedError('bring a valid token')
    }
    return { id: 'u_1', email: 'ada@example.com' } satisfies User
  })
}

const app = ingenium()
await app.register(auth, { token: 'let-me-in' })

app.get('/me', (ctx) => ctx.user)

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
