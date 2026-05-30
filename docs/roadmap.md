# Ingenium Roadmap

## ⚠️ Production caveats — read first

**Not production-ready for multi-instance deploys.** The default in-memory stores for sessions, idempotency, and rate-limit don't share state across pods. Use the Redis-backed adapters in [`ingenium-redis`](../packages/ingenium-redis) before deploying behind a load balancer.

**Alpha API surface.** Verb registration, `ctx` shape, and middleware composition are stable enough to use; everything tagged `@internal` may change before 0.1.0.

## Version targets

| Milestone | Goal | Status |
|---|---|---|
| **v0.0.x** | Feature-complete framework surface; alpha API. | current |
| **v0.1.0** | All Redis stores shipped; plugin scoping; `ExtractParams` runtime narrowing; benchmark matrix on CI. | in progress |
| **v1.0.0** | API frozen. SemVer stability commitment. Production deployments officially supported. | planned |

## Shipped in v0.0.1

- `ingenium()` app factory with lazy-composed middleware pipeline and `app.compose()` pre-warm.
- `Router()` with prefix mounting and nested routers.
- `IngeniumContext` request/response surface (params, query, headers, `state`, status/header setters, terminal writers `json` / `text` / `html` / `send` / `redirect` / `stream`).
- `IngeniumBody` lazy parsers: `json`, `text`, `urlencoded`, `buffer`, `stream`, `multipart`. **Buffer-level parse cache** — multiple consumers can re-read the body without "already consumed" errors.
- `app.inject({ method, url, headers, body })` — in-process test client returning `{ status, headers, body, json<T>() }`. No socket, no transport — same dispatch path as the wire.
- `app.route(path).get(h).put(h).delete(h).all(h)` — chainable per-path builder. Pure registration sugar; same verb semantics, typed params via `ExtractParams<P>`.
- `app.route(path).get(h).put(h).delete(h).all(h)` — chainable per-path builder. Pure registration sugar; same verb semantics, typed params via `ExtractParams<P>`.
- `ctx.cookies` — first-class cookie API with signed-cookie support (`cookieSecrets` on app options, HMAC-SHA-256 with key rotation).
- Inline OpenAPI route options — `app.get(path, { tags, summary, response, requestBody, deprecated, ... }, handler)` peels off well-known keys at registration and routes them through `describe()`.
- `app.scope(prefix, register)` — plugin and middleware scoping onto a path subtree. Compose-time resolution; hot path unchanged. Plugins target `PluginTarget` (implemented by both `IngeniumApp` and `ScopedApp`).
- Type-level `ExtractParams<Path>` narrowing on verb handlers — `app.get('/users/:id', ctx => ctx.params.id)` types as `string`.
- `ctx.query.parse(schema)` symmetric with `ctx.body.json(schema)`. Shallow-array-aware coercion (repeated keys → `string[]`).
- Handler return-value reflection (object → JSON, string → text/html, `Buffer` → octet-stream, `Readable` → stream, `undefined` → 204).
- Path syntax with `:param`, `:param?`, `*wild`, deterministic precedence (static > param > wildcard).
- Error class hierarchy (`IngeniumError` and friends) with default JSON error boundary; `app.onError` override + re-throw delegation.
- Standard Schema v1 integration in `ctx.body.json(schema)` and `ctx.query.parse(schema)` (alongside Zod-style `safeParse` and duck-typed `{ parse }`).
- Express compat shim (`expressCompat`) — real-stream `req`/`res` shims; `(req, res, next)` middleware is a genuine drop-in (cors, helmet, body-parser, multer, compression, express-session, morgan, express-rate-limit).
- Node HTTP adapter with `app.listen(port, host?)` returning `{ port, close }`.
- Bun adapter (`ingenium-bun`) — `BunAdapter` transport for `Bun.serve()` sharing the same `app.handle(ctx)` dispatch entry, with a Web-Streams ↔ `node:stream` bridge.
- HTTP/2 (h2) + HTTP/2 cleartext (h2c) transports.
- WebSocket support via the opt-in `ws` peer dep; SSE helper sharing the same dispatch entry.
- Plugin system — `app.register(plugin, opts?)` with lifecycle hooks (`onRoute`, `onCompose`, `onRequest`, `onResponse`, `onError`) and per-request decorators (`app.decorate` lazy, `app.decorateRequest` eager). Hot path short-circuits when nothing is registered.
- Production primitives — `ingenium.static`, `ingenium.cors`, `ingenium.csrf`, `ingenium.rateLimit`, `sessionMiddleware`, `ingenium.idempotency`, `ingenium.jwt`, `ingenium.apiKey`, `ingenium.problemDetails`, content negotiation, trust-proxy, graceful shutdown.
- Hardening — header injection guard, `ctx.json()` safety on circular/BigInt, `IngeniumTimeoutError` (503) with late-write protection via the `_epoch` counter, hard transport-layer body cap (`maxRequestBytes`).
- Dev-mode footgun warnings (NODE_ENV-gated, zero prod cost) — `IngeniumDoubleWriteWarning`, `IngeniumTrustProxyWarning`, `IngeniumResponseObjectWarning`, plus a hard `TypeError` on `app.listen()` called twice.
- CLI scaffolder — `ingenium new <name> [--bun|--minimal]` (`ingenium-cli`) for bootstrapping new apps.
- ADR docs — `docs/adr/0001`–`0005` covering the load-bearing decisions (radix-trie router, lazy composition with dirty bit, return-value reflection, context pool, compat shim scope).

---

## Performance

We do not publish benchmark numbers in this repo. Run the local harness in
`benchmarks/scenarios/v2/` against your own hardware and workload — those
results are what matter for your decision. Publishable comparative numbers
require isolated hardware, CPU pinning, multi-run / std-dev aggregation, and
pinned framework versions; the bench scripts here are regression detectors
during development, not marketing material.

---

## Known issues — bugs

- **`ExtractParams` doesn't narrow constrained params** — `:id(\\d+)` strips the constraint and stays `string`. Unconstrained params (`:id`) now narrow correctly. The router doesn't yet honor inline constraints at runtime; types and runtime have to land together.

## Known issues — gaps

- **No per-route OpenAPI inline schema yet** — schemas live in a separate `app.describe(...)` call instead of `app.get('/path', { response: Schema }, handler)`. Tracked for 0.1.0.

---

## Deferred to next session

### Full benchmark matrix vs Fastify + Hono on CI

The local `bench:v2` harness covers hello-world, JSON echo, and middleware-stack on Node — and includes Hono, Fastify, and Express side-by-side. What's still missing: pinned dependency versions, isolated CPU pinning, Bun runs in the same matrix, 1KB / 100KB payload scenarios, RSS tracking, and a CI runner that publishes the numbers per PR. Honest comparative numbers need that infra; spinning it up is its own session.

### Inline OpenAPI schema conversion

Inline `{ response, requestBody }` accepts only raw OpenAPI Schema objects today. Standard Schema / Zod validators passed inline throw at registration. Lift the limitation by adapting validators → JSON Schema via vendor-specific helpers (TypeBox is JSON Schema natively; Zod has `zod-to-json-schema`).

### Session / CSRF migration to `ctx.cookies`

Both subsystems still hand-roll cookie writes — there's a `// TODO: migrate to ctx.cookies` marker on each. Migrating is largely mechanical but the existing tests need to still pass on the rolling-session edge cases.

### TypeBox-specific bridge

Standard Schema v1 covers TypeBox already; a tighter integration that consumes TypeBox compiled validators could shave validation overhead. Worth doing only after the benchmark matrix lands so the gain is measurable.

### Constrained param type narrowing

Extend `ExtractParams<Path>` to recognize numeric / regex / enum constraints in the path syntax (e.g. `/users/:id(\\d+)`) and narrow `ctx.params.id` to `number`. Deferred because the routing layer doesn't yet honor inline constraints at runtime; types and runtime have to land together.

### Scoped decorators

`app.scope(...)` scopes middleware today but decorators remain global (a lazy decorator installs onto the pooled context at request start, before the route is matched). Making them path-aware requires a runtime check on every property access — measure before shipping.

---

## Open questions

- **Lazy compose dirty-bit cost under heavy mutation.** Apps that register routes per-request (rare, but possible in plugin-heavy or hot-reload setups) will recompose on every request. Do we cap it, warn after N recomposes per minute, or expose a `freeze()` toggle for production?
- **Compat shim long-tail support strategy.** The Express ecosystem is huge and each `req` / `res` accessor we proxy widens the surface. Do we aim for "covers the top 20 middleware on npm" with documented gaps, or stay minimal and route everyone to native ports?

---

## Non-goals

- **A full Express drop-in.** The compat shim is for the long tail of `(req, res, next)` middleware; it is not a goal to make Express apps work unmodified. The migration guide is the supported path.
- **A monorepo bundler / framework wrapper.** Ingenium is the HTTP framework. View templating, ORM, CLI for app structure are out of scope.
- **Multi-runtime fetch-style `Response` interop.** Handlers return plain values or call `ctx` writers. We will not add `return new Response(...)` translation; the dev warning makes the mistake loud and the fix is one line.
- **A community plugin marketplace.** Plugins are npm packages; discovery happens via npm and the docs index.
