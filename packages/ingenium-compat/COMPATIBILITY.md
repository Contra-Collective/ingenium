# Express Middleware Compatibility

`ingenium-compat` lets you wrap Express-style `(req, res, next)` middleware
with `expressCompat()` and run it inside a Ingenium middleware chain. Not
every middleware survives the shim — this document records what we have
verified end-to-end against `packages/ingenium-compat/test/e2e.test.ts`.

## Status legend

- **Supported** — works end-to-end with no caveats.
- **Partial** — works for the common path but has at least one gap callers
  should know about.
- **Unsupported** — does not work; users should reach for the listed Ingenium-native
  alternative.

## Matrix

| Middleware            | Status      | Notes |
|-----------------------|-------------|-------|
| `cors`                | Supported   | Simple requests + OPTIONS preflight both verified. |
| `helmet`              | Supported   | All default headers (X-Content-Type-Options, X-Frame-Options, CSP, HSTS, etc.) land on the response. |
| `cookie-parser`       | Supported   | `req.cookies` is mirrored back into `ctx.state.cookies` for downstream Ingenium middleware. |
| `morgan`              | Partial     | The request line is logged. Tokens that depend on `res.on('finish')` (`:status`, `:res[…]`, `:response-time`) render as `-` because the res-shim is not an `EventEmitter`. |
| `express-rate-limit`  | Partial     | 429 + `RateLimit-*` headers verified. Caller MUST supply a `keyGenerator` and pass `validate: false`, because the shim does not populate `req.ip`. |
| `compression`         | Unsupported | Patches `res.write` / `res.end` to swap in a gzip stream — neither method exists or behaves the way `compression` expects. The middleware silently no-ops; responses ship uncompressed with no `Content-Encoding`. **Workaround:** wait for a Ingenium-native gzip middleware (or set `Content-Encoding` manually for prebuilt static assets). |
| `body-parser`         | Unsupported | Calls `req.on('data')` / `req.on('end')`; req-shim has no event emitter. Throws `TypeError: req.on is not a function` → 500. **Workaround:** use `await ctx.body.json()` / `ctx.body.urlencoded()` — Ingenium parses request bodies natively with the same default 100 kB limit. |
| `passport.initialize` | Partial     | Runs without throwing; `req._passport` propagates to `ctx.state`. |
| `passport.authenticate` | Unsupported | Strategies finish via `res.redirect()` and `req.logIn()` callbacks that assume the full Express response surface (no `redirect` on our shim). **Workaround:** implement auth on top of `IngeniumContext` directly. |
| `express-session`     | Unsupported | Monkey-patches `res.end` to persist the session and emit `Set-Cookie` lazily. The shim's `end` is a sync one-shot; the patched flush never runs and `Set-Cookie` is never written. **Workaround:** use `sessionMiddleware` from `ingenium`. |
| `multer`              | Unsupported | Calls `req.pipe(busboy)`; the req-shim is not a Readable. Throws `TypeError: req.pipe is not a function` → 500. **Workaround:** use `await ctx.body.multipart()`. |

## What happens now (detect-and-throw guard)

As of the latest `ingenium-compat` release, `expressCompat()` runs a
**cheap, one-time detection pass at registration** against the known-broken
set above. If you wrap one of these middlewares, `expressCompat()` will
**throw a `TypeError` immediately** — not at request time, not silently —
naming the package and the Ingenium-native equivalent you should use.

Example:

```ts
app.use(expressCompat(bodyParser.json()))
// → TypeError: expressCompat(): refusing to wrap `body-parser`'s jsonParser
//   — it consumes the request stream via req.on('data')/req.on('end'), which
//   the shim cannot proxy and would hang forever. Use Ingenium's native
//   equivalent instead: `await ctx.body.json()`. See
//   packages/ingenium-compat/COMPATIBILITY.md for the full matrix.
```

**Detection mechanism:** the wrapped function's `.name` is matched against
an allow-list (`jsonParser`, `urlencodedParser`, `textParser`, `rawParser`,
`multerMiddleware`, `session`, `compression`). It is intentionally
conservative — obfuscated, renamed, or user-rewrapped middleware will pass
through silently rather than risk a false positive.

### Opt-out

If you have a specific reason to run a known-broken middleware anyway
(experimentation, a custom fork that fixed the underlying issue, etc.),
pass the opt-out flag:

```ts
app.use(expressCompat(bodyParser.json(), { allowKnownBroken: true }))
```

This downgrades the throw to a `process.emitWarning(...)` with the
`IngeniumCompatKnownBroken` warning name, and returns a working wrapping
middleware. The underlying compatibility problem is unchanged — the
middleware will still no-op / hang / crash as documented above.

## Why the unsupported set fails

Three architectural mismatches account for every failure on this list:

1. **`req` is a plain object, not a Readable / EventEmitter.** Anything that
   reads the request body (`body-parser`, `multer`) or wants
   `req.on(…)` / `req.pipe(…)` will trip immediately. Ingenium consumes
   the body via `ctx.body.*`, so the shim does not pass the underlying
   `IncomingMessage` through.
2. **`res` is a plain object, not a writable / EventEmitter.** Anything that
   patches `res.write` / `res.end` to interpose its own stream
   (`compression`) or that hooks `res.on('finish', …)` to do work after the
   response (`morgan` end-tokens, `express-session` save-on-end) cannot
   reach into the real socket. The Ingenium `NodeAdapter` writes the response
   from `ctx._headers` / `ctx._body` after dispatch returns, so any header
   added in a deferred callback lands too late.
3. **No `res.redirect` / chained-callback surface.** Middlewares like
   `passport.authenticate` finish their work by redirecting; our shim
   doesn't model that path because IngeniumContext uses `ctx.redirect(…)`
   directly.

## Running the suite

```
npm test -- packages/ingenium-compat/test/e2e.test.ts
```

The suite boots a fresh `IngeniumApp` on `app.listen(0)` per describe block,
issues real `fetch()` calls, and tears down with
`server.close({ gracefulTimeoutMs: 100 })`.

## Counts

- 4 supported (cors, helmet, cookie-parser, plus `passport.initialize` as
  a partial)
- 2 partial (morgan, express-rate-limit)
- 4 unsupported (compression, body-parser, express-session, multer)
- 1 mixed (passport: `initialize()` works, strategies do not)
