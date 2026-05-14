// ─────────────────────────────────────────────────────────────────────────────
//  Step 2 — Path params and the query string.
//
//  Concepts:
//    • `:name` in the route declares a required path param → `ctx.params.name`
//    • `:name?` makes it optional
//    • `ctx.query` is a URLSearchParams instance (`.get`, `.getAll`)
//    • Returning an object reflects to JSON automatically
//
//  Run:        npm run 2
//  Try it:     curl http://localhost:3000/users/42
//              curl 'http://localhost:3000/search?q=rift&page=2'
// ─────────────────────────────────────────────────────────────────────────────

import { riftex } from 'riftexpress'

const app = riftex()

app.get('/users/:id', (ctx) => ({
  id: ctx.params.id,
}))

app.get('/posts/:slug?', (ctx) => ({
  slug: ctx.params.slug ?? '(all posts)',
}))

app.get('/search', (ctx) => ({
  query: ctx.query.get('q'),
  page: Number(ctx.query.get('page') ?? 1),
}))

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
