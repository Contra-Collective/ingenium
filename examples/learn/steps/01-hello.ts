// ─────────────────────────────────────────────────────────────────────────────
//  Step 1 — Hello, Ingenium.
//
//  Concept: every Ingenium app starts with `ingenium()`. Handlers receive
//  a single `ctx` (not `req` / `res`), and whatever you return is reflected
//  to the wire — string → text, object → JSON, undefined → 204.
//
//  Run:        npm run 1
//  Try it:     curl http://localhost:3000
// ─────────────────────────────────────────────────────────────────────────────

import { ingenium } from 'ingenium'

const app = ingenium()

app.get('/', () => 'hello, world')

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
