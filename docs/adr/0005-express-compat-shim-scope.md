# ADR 0005: Express compatibility shim — what's in, what's out

## Status
Accepted (2026-05-12)

## Context
RiftExpress's pitch is "Express ergonomics, modern internals". A real
Express user has years of muscle memory and an `app.use(cors())` line they
copied from a tutorial. If that line throws, they bounce.

But the Express ecosystem is enormous — every middleware ever published on
npm against the `(req, res, next)` signature, in principle. We cannot adapt
all of it. Some middleware reaches into Express internals (`req.app`,
`req.route`, `res.locals`, the `Layer` and `Route` classes, `Router#stack`)
that we deliberately don't expose. Some middleware does file I/O
(`multer`'s disk storage), session storage (`express-session`), or auth
state (`passport`) that has to integrate with our context lifecycle, not
just bolt on.

We need a clear, defensible line. "We support a subset" is not a line; "we
support exactly these well-known middlewares, and these other ones need
native ports" is.

API.md gives us the levers:

- `RiftexMiddleware` is `(ctx, next) => unknown | Promise<unknown>` — different
  shape from Express's `(req, res, next)`.
- The shim's job is to take an Express middleware and produce a `RiftexMiddleware`
  that bridges `req` → ctx.req and `res` → a thin object that proxies the
  Express response API to `ctx`.

## Decision
The Express compat shim covers exactly this class of middleware:

- **Stateless wrappers**: `cors`, `helmet`, `morgan`, `compression`,
  `serve-static`, `response-time`, `method-override`.
- **Stateless body-affecting**: nothing — body parsing has its own native
  path via `ctx.body.json()` etc., and the `riftex.json()` / `riftex.urlencoded()`
  factories are no-op shims that exist purely so `app.use(express.json())`
  compiles (per API.md).

The shim does **not** cover, and these need native ports:

- **`multer`** — multipart parsing has to integrate with our `RiftexBody`
  streaming model, otherwise we get double-buffering or stream lifecycle
  bugs.
- **`passport`** — the strategy lifecycle assumes Express's `req.login`,
  `req.logout`, and session middleware integration. Bridging it without
  rewriting strategy plumbing produces something that mostly-works and
  fails in subtle ways at production scale.
- **`csurf` / `csrf-csrf`** — token storage and validation hooks into the
  session/cookie layer, which we own.
- **`express-session`** — session store contract and cookie signing both
  bind tightly to context lifecycle and the response writer phase.
- **Anything that reaches into `req.app`, `req.route`, `req.baseUrl`,
  `req.originalUrl`, or `res.locals`** — these aren't Express features, they
  are Express *internals* that have leaked into ecosystem APIs.

Shim location: a separate package (`@riftexpress/express-compat`) that
re-exports a `fromExpress(mw)` function and ships pre-wrapped re-exports
for the supported list. The core `riftexpress` package has zero awareness
of Express types.

## Consequences

Positive:
- Migration story is honest: "paste your `cors`/`helmet`/`morgan` lines,
  port your `multer`/`passport`/`csurf` setups." Users know up front what
  changes.
- The supported list is small enough that we can keep an integration test
  per middleware. Each one is pinned at a specific version, and we run
  the test suite on every PR.
- Core stays small. No Express types, no `req.app`/`res.locals` shims, no
  perpetual catch-up on Express internals as ecosystem code drifts.
- The line — "stateless wrapper, no internals access" — is testable. We
  can refuse new shim adds with one rule rather than per-middleware
  judgement calls.

Negative:
- The unsupported list is a real migration cost. Teams using `passport`
  heavily will not migrate, period, until we ship a native auth story.
- The shim's `(req, res)` proxy isn't free — every shimmed middleware pays
  a per-request property-access proxy overhead. Acceptable for the supported
  middlewares (which are I/O-bound or do little work per request) but
  dangerous if users start shimming hot-path code through it. Documented.
- We will get bug reports for "this random `(req, res, next)` middleware
  doesn't work". The answer is "it's outside the supported set," and we
  have to be willing to keep saying that.
- A native port of e.g. `passport` is real engineering work that doesn't
  exist yet. Until it does, the migration path for auth-heavy Express apps
  is incomplete.

## Alternatives considered

- **Full Express compat (Express's own surface, pretend to be Express).**
  Conceptually, fork Express and swap the router/dispatch internals.
  Rejected — perpetual catch-up on every internal change Express makes,
  and the entire performance story collapses because we'd be honoring
  `Layer`, `Route`, `req.app` etc. which were never designed for our
  context model.
- **No compat at all.** Cleanest. Forces every user to rewrite. This is
  what Polka chose, and it's part of why Polka has stayed niche despite
  being fast. Rejected — the migration story is the whole pitch.
- **Best-effort shim with a "may not work" disclaimer for everything.**
  Worst of both worlds. Users get bugs in production from middleware that
  "kind of" worked. Rejected.
- **Auto-detect and shim at `app.use()` time** — try to recognize Express
  middleware by signature length and wrap automatically. Magic, fragile,
  hides the supported/unsupported boundary. Rejected.

## Prior art
- Hono's Express adapter — small surface, similar "stateless wrappers OK,
  internals leak no" line. Closest direct precedent.
- Polka — chose "no compat at all". Demonstrates the cost of that choice.
- Fastify's `@fastify/express` plugin — provides full Express compat by
  literally embedding Express. The performance numbers under that plugin
  are notably worse than native Fastify, which validates our refusal to
  ship a full-compat path.
- Koa's lack of Express compat — Koa took the same "different runtime
  model, no shim" stance Polka did, and survived because the
  middleware-as-async-function model attracted its own ecosystem. We don't
  have that yet, so the partial shim is the bridge.
