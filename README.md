# RiftExpress

> Express ergonomics, modern internals. A small, typed HTTP framework for Node 20+ and Bun.

RiftExpress is a Node/Bun HTTP framework for people who like Express's shape — `app.get`, `app.use`, mountable routers — but want a typed `ctx`, lazy-composed middleware, return-value reflection, and a router that doesn't degrade with route count. It is intentionally small (one factory, one context, one router) and intentionally familiar: most Express code ports over by renaming `app` to `rex()` and dropping the `req, res, next` triple for a single `ctx`.

## Show me the code

Express developers should recognize this immediately:

```ts
import { rex } from 'riftexpress'

const app = rex()

app.use(async (ctx, next) => {
  const start = Date.now()
  await next()
  console.log(`${ctx.method} ${ctx.path} -> ${Date.now() - start}ms`)
})

app.get('/', () => 'hello')
app.get('/users/:id', (ctx) => ({ id: ctx.params.id }))
app.post('/echo', async (ctx) => ctx.body.json())

await app.listen(3000)
```

No `res.send`. No `res.json`. Return a value and RiftExpress reflects it to the wire — object → JSON, string → text/html, `Buffer` → octet-stream, `Readable` → stream, `undefined` → 204. You can still call `ctx.json(...)` when you want explicit control over status or headers.

## Why

- **Express is slow and untyped.** The router is linear, every middleware allocates, and `req`/`res` are typed as `any` in practice. Fine for a Friday-afternoon API; painful at scale.
- **Hono and Fastify are fast but unfamiliar.** Hono's Web-Standards-first model and Fastify's plugin/decorator system both require relearning the framework. There's a non-trivial cost to switching.
- **RiftExpress threads the needle.** Same shape as Express, typed end-to-end, radix-trie router, pooled context, lazy middleware compose. You get the throughput-ish numbers without re-learning your framework.

## Install

```sh
npm install riftexpress
```

Peer requirement: **Node >= 20**. Bun 1.1+ is supported via [`riftexpress-bun`](packages/riftexpress-bun).

## Features

- Radix-trie router with deterministic precedence (static > `:param` > `*wildcard`) and typed path params via `ExtractParams<'/users/:id'>`
- Pooled `RexContext` — hot-path requests reuse context objects to avoid per-request allocation churn
- Lazy middleware composition with a dirty bit — register routes after `listen()` and the next request sees them
- Return-value reflection — handlers can `return` instead of calling response methods
- Lazy body parsers on `ctx.body` (`json`, `text`, `urlencoded`, `buffer`, `stream`) with optional Zod-like schema validation
- Static-file middleware (`rex.static(root, opts?)`) with ETag, range requests, and MIME detection
- Plugin system — `app.register(plugin, opts?)`, lifecycle hooks (`onRoute`, `onCompose`, `onRequest`, `onResponse`, `onError`), and `app.decorate` / `app.decorateRequest`
- Express compat shim (`expressCompat`) for pure-function middleware (`cors`, `helmet`, `morgan`, `compression`)
- Pluggable transport — Node `http` by default, Bun via `riftexpress-bun`

## Performance

Honest framing: separate-process autocannon, 5 samples + warmup, Node 24 on a dev machine. Mean rps:

| Scenario               | Express | Fastify | Hono   | **RiftExpress** | vs Express |
|------------------------|---------|---------|--------|-----------------|------------|
| hello (`GET /` JSON)   | 14,691  | 30,162  | 22,131 | **31,221**      | **2.13×**  |
| body-json (POST echo)  | 17,352  | 14,871  | 10,062 | **27,726**      | **1.60×**  |
| middleware-stack (10×) | 24,015  | 23,531  | 24,327 | **31,081**      | **1.29×**  |

RiftExpress is the fastest of the four in all three scenarios on this machine. We did not hit the original 4× hello-world target, but the actual hard goal — competitive with Hono and Fastify — is met. Caveats and reproduction details in [docs/roadmap.md](docs/roadmap.md).

Reproduce on your hardware:

```sh
cd benchmarks
npx tsx scenarios/v2/hello.ts
npx tsx scenarios/v2/body.ts
npx tsx scenarios/v2/middleware.ts
```

## Packages in this monorepo

| Package | Description |
| --- | --- |
| [`riftexpress`](packages/riftexpress) | Core framework — `rex()`, `Router`, `RexContext`, plugins, static, transport |
| [`riftexpress-compat`](packages/riftexpress-compat) | `expressCompat(mw)` shim for `(req, res, next)` middleware (cors/helmet/morgan/compression) |
| [`riftexpress-bun`](packages/riftexpress-bun) | `BunAdapter` — drop-in transport for `Bun.serve()` |
| [`riftexpress-cli`](packages/riftexpress-cli) | `rex new <name> [--bun\|--minimal]` project scaffolder |

## Documentation

- [Migration guide](docs/migration-guide.md) — porting from Express, route by route
- [Plugins](docs/plugins.md) — `register`, hooks, decorators, module augmentation
- [Roadmap](docs/roadmap.md) — what shipped, what's deferred, what's known-broken
- [Architecture decision records](docs/adr/) — load-bearing design choices and the rationale behind them
- [API reference](API.md) — locked public surface for v0.0.1

## Status

**Alpha.** This is v0.0.1. Not production-ready. The public API surface in [`API.md`](API.md) is the contract for v0.0.1, but expect breaking changes before 0.1 — particularly around the plugin system (still settling) and the body-parser stubs (`rex.json` / `rex.urlencoded` are no-ops today).

Bug reports and design feedback are welcome. PRs that add new features without prior discussion are unlikely to land — read [docs/roadmap.md](docs/roadmap.md) first.

## License

MIT.
