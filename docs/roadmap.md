# RiftExpress Roadmap

## Shipped in v0.0.1

- `riftex()` app factory with lazy-composed middleware pipeline and `app.compose()` pre-warm.
- `Router()` with prefix mounting and nested routers.
- `RiftexContext` request/response surface (params, query, headers, `state`, status/header setters, terminal writers `json` / `text` / `html` / `send` / `redirect` / `stream`).
- `RiftexBody` lazy parsers: `json` (with optional Zod-like schema + `maxBytes`), `text`, `urlencoded`, `buffer`, `stream`.
- Handler return-value reflection (object → JSON, string → text/html, `Buffer` → octet-stream, `Readable` → stream, `undefined` → 204).
- Path syntax with `:param`, `:param?`, `*wild`, deterministic precedence (static > param > wildcard).
- Error class hierarchy (`RiftexError` and friends) with default JSON error boundary; `app.onError` override + re-throw delegation.
- Express compat shim (`expressCompat`) for pure-function middleware (cors, helmet, etc.).
- Node HTTP adapter with `app.listen(port, host?)` returning `{ port, close }`.
- **Bun adapter** (`riftexpress-bun`) — `BunAdapter` transport for `Bun.serve()` sharing the same `app.handle(ctx)` dispatch entry, with a Web-Streams ↔ `node:stream` bridge.
- **Plugin system** — `app.register(plugin, opts?)` with lifecycle hooks (`onRoute`, `onCompose`, `onRequest`, `onResponse`, `onError`) and per-request decorators (`app.decorate` lazy, `app.decorateRequest` eager). Hot path short-circuits when nothing is registered.
- **Static file middleware** — `riftex.static(root, opts?)` with ETag, conditional GET, range requests, MIME detection, `index` / `extensions` / `dotfiles` / `maxAge` options.
- **CLI scaffolder** — `riftex new <name> [--bun|--minimal]` (`riftexpress-cli`) for bootstrapping new apps.
- **ADR docs** — `docs/adr/0001`–`0005` covering the load-bearing decisions (radix-trie router, lazy composition with dirty bit, return-value reflection, context pool, compat shim scope).

---

## Performance — current honest numbers

Reproduce: `npm install` then `npx tsx scenarios/v2/hello.ts` (and `body.ts`,
`middleware.ts`) inside `benchmarks/`. **Separate Node child processes per
framework, 5 samples + warmup, autocannon `-c 100 -d 5`, Node 24.12 on a
Windows dev machine.**

| Scenario               | Express | Fastify | Hono   | **RiftExpress** | vs Express |
|------------------------|---------|---------|--------|-----------------|------------|
| hello (`GET /` JSON)   | 14,691  | 30,162  | 22,131 | **31,221**      | **2.13×**  |
| body-json (POST echo)  | 17,352  | 14,871  | 10,062 | **27,726**      | **1.60×**  |
| middleware-stack (10×) | 24,015  | 23,531  | 24,327 | **31,081**      | **1.29×**  |

(rps mean across 5 samples)

RiftExpress is the **fastest of the four** in all three scenarios on this
machine. We did not hit the original 4× hello-world target, but the
"competitive with Hono and Fastify" bar — the actual hard goal — is met,
and slightly exceeded.

Caveats (read these before quoting the numbers anywhere):

- Single dev machine, no CPU pinning, no thermal control, Windows.
- One run per scenario (5 samples is small).
- Framework versions: Express `^4.21`, Fastify `^5.0`, Hono `^4.6` — pinned in
  `benchmarks/package.json` but not minor-locked.
- Hono's body-json number looks low for Hono — possibly `@hono/node-server`
  overhead or unfair config; investigate before publishing.
- Bun adapter not benchmarked yet (no Bun on the test machine).

The "local regression detector" framing in `benchmarks/README.md` still applies.
For publishable claims, isolated hardware + many runs + pinned versions are
required.

---

## Deferred to next session

### Full benchmark matrix vs Fastify + Hono on CI

The local `bench:v2` harness covers hello-world, JSON echo, and middleware-stack on Node — and includes Hono, Fastify, and Express side-by-side. What's still missing: pinned dependency versions, isolated CPU pinning, Bun runs in the same matrix, 1KB / 100KB payload scenarios, RSS tracking, and a CI runner that publishes the numbers per PR. Honest comparative numbers need that infra; spinning it up is its own session.

### TypeBox / Standard Schema integration

First-class support for [Standard Schema](https://standardschema.dev) so `ctx.body.json(schema)` works with TypeBox, Valibot, ArkType, etc., not just Zod's `safeParse`. Deferred because the current `{ parse(input): T }` duck-type already covers Zod and most validators; promoting to Standard Schema is a small but non-trivial type-level change worth doing deliberately.

### Constrained param type narrowing

Extend `ExtractParams<Path>` to recognize numeric / regex / enum constraints in the path syntax (e.g. `/users/:id(\\d+)`) and narrow `ctx.params.id` to `number`. Deferred because the routing layer doesn't yet honor inline constraints at runtime; types and runtime have to land together.

### Native multipart / file upload

A `ctx.body.multipart()` API so `multer`-shaped use cases stop needing a hand-rolled parser. The compat shim can't proxy `multer` because it owns the request stream; this needs to be native.

### Native rate-limit + session helpers

`express-rate-limit`, `express-session`, and `csurf` all hook the Express response lifecycle in ways the compat shim can't proxy. v0.1 should ship minimal native equivalents (or a documented integration path) so users aren't forced to drop down to the raw transport.

---

## Open questions

- **Lazy compose dirty-bit cost under heavy mutation.** Apps that register routes per-request (rare, but possible in plugin-heavy or hot-reload setups) will recompose on every request. Do we cap it, warn after N recomposes per minute, or expose a `freeze()` toggle for production?
- **Compat shim long-tail support strategy.** The Express ecosystem is huge and each `req` / `res` accessor we proxy widens the surface. Do we aim for "covers the top 20 middleware on npm" with documented gaps, or stay minimal and route everyone to native ports?
- **Standard Schema vs Zod-specific.** Should the `schema` arg on `ctx.body.json` accept `StandardSchemaV1` natively (and we ship our own minimal implementation for users without a validator), or stay duck-typed on `{ parse }` and let users adapt? The former is more ergonomic; the latter keeps the core dep-free.
- **Plugin scoping.** Today a plugin's hooks and decorators apply to the entire app. Should we add a "scope" concept (Fastify-style) so a plugin registered under `app.use('/api', subApp)` only affects requests below that mount point? Useful for multi-tenant apps; significant complexity cost.
