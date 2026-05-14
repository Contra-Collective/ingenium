// ─────────────────────────────────────────────────────────────────────────────
//  Step 5 — Errors and the centralised error boundary.
//
//  Concepts:
//    • Throwing a `RiftexError` subclass gives you the right HTTP status for
//      free — `RiftexNotFoundError` → 404, `RiftexUnauthorizedError` → 401,
//      etc. The default boundary serialises them as `{ error, code }`.
//    • `app.onError((err, ctx) => …)` overrides the default — re-throw the
//      error to delegate back to the built-in boundary for known cases.
//    • Unhandled errors become 500s and do NOT leak stack traces by default.
//
//  Run:        npm run 5
//  Try it:     curl -i http://localhost:3000/users/1     # 200
//              curl -i http://localhost:3000/users/99    # 404 via thrown error
//              curl -i http://localhost:3000/boom        # 500 via uncaught
// ─────────────────────────────────────────────────────────────────────────────

import { riftex, RiftexError, RiftexNotFoundError } from 'riftexpress'

const app = riftex()

const users = new Map<string, { id: string; name: string }>([
  ['1', { id: '1', name: 'Ada' }],
])

app.get('/users/:id', (ctx) => {
  const user = users.get(ctx.params.id)
  if (!user) throw new RiftexNotFoundError(`user ${ctx.params.id} not found`)
  return user
})

app.get('/boom', () => {
  throw new Error('something exploded')
})

app.onError((err, ctx) => {
  if (err instanceof RiftexError) throw err
  console.error('unhandled:', err)
  ctx.json({ error: 'internal server error' }, 500)
})

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
