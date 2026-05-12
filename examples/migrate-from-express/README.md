# riftexpress-example-migration

Side-by-side comparison of the same tiny app written in Express and in RiftExpress. The two files are intentionally structured line-for-line so a `diff` shows exactly how small the surface change is.

## Run

From this directory:

```
npm run express       # http://localhost:3001
npm run riftexpress   # http://localhost:3002
```

Each server exposes the same routes:

- `GET  /users/:id` — 200 with `{ id, name }`, 404 with `{ error }` if missing
- `POST /users` — 201 with the new user, 400 if `id` or `name` aren't strings
- `GET  /api/health` — 200 with `{ ok: true }` (mounted via a sub-router)

## Diffs to look for

1. **Imports** — `express` -> `riftexpress`. `Router` is named the same.
2. **Handler signature** — `(req, res, next)` collapses into a single `ctx`. `req.params` -> `ctx.params`, `req.body` -> `await ctx.body.json()`, `res.json(x)` -> `ctx.json(x)` or just `return x`.
3. **Body parsing** — `express.json()` is up-front and required; `rex.json()` is accepted for compatibility but body parsing is actually lazy (`ctx.body.json()` inside the handler).
4. **Error handling** — Express's 4-arg middleware becomes `app.onError(handler)`.
5. **Logger middleware** — Express needs a `res.on('finish')` hook to time the response. RiftExpress just `await next()` and the timer naturally wraps the request.

## The one intentional breaking change

In Express, handlers must call `res.send/json/end`. In RiftExpress, a handler may also **return** a value and it gets reflected to the wire (objects -> JSON, strings -> text/plain or text/html, etc. — see `API.md`). Both styles are used in `riftexpress-version.ts`; you can pick one or mix them. If you `ctx.json(...)` then the return value is ignored, so existing Express-style code keeps working.
