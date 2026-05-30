# Express Middleware Compatibility

`ingenium-compat` lets you wrap Express-style `(req, res, next)` middleware
with `expressCompat()` and run it inside a Ingenium middleware chain.

As of this release the shims are **real Node streams** — `req` extends
`stream.Readable`, `res` extends `stream.Writable` (and is therefore a real
`EventEmitter`) — wired directly to the `IngeniumContext`. That makes Express
middleware a genuine drop-in: the body-reading and response-transforming
middleware that previously could not work now work end-to-end, verified in
`packages/ingenium-compat/test/e2e.test.ts`.

## Status legend

- **Supported** — works end-to-end.
- **Partial** — works for the common path but has at least one gap callers
  should know about.

## Matrix

| Middleware            | Status      | Notes |
|-----------------------|-------------|-------|
| `cors`                | Supported   | Simple requests + OPTIONS preflight both verified. |
| `helmet`              | Supported   | All default headers (X-Content-Type-Options, X-Frame-Options, CSP, HSTS, etc.) land on the response. |
| `cookie-parser`       | Supported   | `req.cookies` is mirrored back into `ctx.state.cookies` for downstream Ingenium middleware. |
| `morgan`              | Supported   | End-of-request tokens (`:status`, `:res[…]`, `:response-time`) work — the `res` shim emits `finish`, so `on-finished` fires. |
| `express-rate-limit`  | Supported   | `req.ip` is populated from the context, so no custom `keyGenerator` is needed. 429 + `RateLimit-*` headers verified. |
| `compression`         | Supported   | Patches `res.write`/`res.end` to interpose a gzip stream. The wrapper detects the patch and replays the downstream response through `res`, so the body is actually gzipped and `Content-Encoding: gzip` is set. |
| `body-parser`         | Supported   | Reads the real request stream (`req.on('data')`/`req.on('end')`). `req.body` is mirrored into `ctx.state.body`. (You can still prefer `await ctx.body.json()` — it's native and slightly cheaper.) |
| `passport.initialize` | Supported   | Runs and propagates `req._passport` to `ctx.state`. |
| `passport.authenticate` | Partial   | The response surface it needs (`res.redirect`, header/cookie writes) now exists. Strategies that also require a persisted session need a session store (`express-session` via compat, or Ingenium-native `sessionMiddleware`). Test your specific strategy. |
| `express-session`     | Supported   | Writes `Set-Cookie` via `on-headers` and saves on `res.end`; both fire through the real Writable shim. Verified that `connect.sid` is set. |
| `multer`              | Supported   | `req.pipe(busboy)` works against the real Readable. `req.file`/`req.files` are mirrored into `ctx.state`. (Native alternative: `await ctx.body.multipart()`.) |

## How it works

`expressCompat(mw)` returns a Ingenium middleware that, per request:

1. Builds an `IngeniumReqShim` (a `Readable`) and an `IngeniumResShim`
   (a `Writable`) over the `IngeniumContext`.
   - **Headers and status are proxied live** to the context, so header-only
     middleware (`cors`, `helmet`) that just `setHeader` and call `next()` land
     their changes with no body round-trip.
   - **The request body is lazy** — the underlying request stream is only
     claimed when the middleware actually reads it. Header-only middleware pay
     nothing for the body.
2. Runs the middleware. Then:
   - If it **wrote the response** (`res.json/send/end`), the response is
     flushed to the context and the chain stops.
   - If it called **`next()`**, the Ingenium downstream chain runs. If the
     middleware **patched `res.write`/`res.end`** (the compression /
     express-session pattern), the downstream response is replayed through
     `res` so the patch takes effect; otherwise the downstream response is left
     untouched (fast path) and a synthetic `finish` is emitted for observers
     like `morgan`.
   - If it called **`next(err)`** or threw, the wrapper rejects so the error
     reaches the global `onError` boundary.
3. Mirrors `req.*` mutations (`req.user`, `req.body`, `req.cookies`,
   `req._passport`, …) back into `ctx.state` before the downstream chain reads
   them.

## Performance

The compat cost is **opt-in and localized** — it is paid only on requests that
pass through a wrapped middleware. The core ingenium fast paths (O(k) trie
routing, compile-time middleware composition, pooled context) are untouched, so
native handlers and native middleware run at full speed. For a wrapped
middleware the overhead is roughly what Express itself pays for that middleware;
header-only middleware stay close to free thanks to the live header proxy and
lazy body.

## Native alternatives

Several of the supported middleware have Ingenium-native equivalents that are
integrated more tightly and avoid the shim entirely. Prefer them when starting
fresh:

- Body parsing → `await ctx.body.json()` / `ctx.body.urlencoded()` /
  `ctx.body.text()` / `ctx.body.buffer()` / `ctx.body.multipart()`
- Sessions → `sessionMiddleware` from `ingenium`
- CORS / CSRF / rate limiting / API keys / JWT → the native middleware exported
  from `ingenium`

## Running the suite

```
npm test -- packages/ingenium-compat/test/e2e.test.ts
```

The suite boots a fresh `IngeniumApp` on `app.listen(0)` per describe block,
issues real HTTP requests, and tears down with
`server.close({ gracefulTimeoutMs: 100 })`.
