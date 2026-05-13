# ADR 0004: Context object pool

## Status
Accepted (2026-05-12)

## Context
On every request, RiftExpress needs a `RiftexContext` instance — the object
exposed to middleware and handlers as `ctx` (see `API.md` §RiftexContext). It
holds the request side (method, url, path, query, params, headers, body) and
the response setters/writers (status, set, json, text, html, stream, redirect,
send). It also carries `state: Record<string, unknown>` for per-request scratch.

A naive implementation allocates a fresh `RiftexContext` per request:

```ts
async dispatch(req, res) {
  const ctx = new RiftexContext(req, res)
  await this.handle(ctx)
}
```

At 100k req/s that is 100k allocations per second of a moderately complex
object plus its `state: {}` object plus a `URLSearchParams` plus the
`RiftexBody` instance. V8 generational GC handles this fine for small objects,
but `RiftexContext` has ~15 fields and several nested allocations, which puts
pressure on the young generation and triggers more frequent minor GCs.
Minor GCs are stop-the-world. Stop-the-world on the request thread shows up
as p99 latency spikes.

API.md commits us to a pool: `riftex({ poolSize?: number })` and the
`RiftexAppOptions.poolSize` field on `RiftexApp`. The default is 1024 (see
`packages/riftexpress/src/app.ts`).

## Decision
Pre-allocate a free list of `RiftexContext` instances in `RiftexContextPool`.
On request: pop one off the free list (or `new RiftexContext()` if the list is
empty), call `ctx.reset(req, res)` to populate it, dispatch, then push it
back onto the free list. The pool has a fixed maximum (`poolSize`) — once
the free list is full, additional contexts are dropped to GC.

The transport (`packages/riftexpress/src/transport/node.ts`) calls
`acquire`/`release` from the per-request flow:

```ts
{
  acquire: () => this.pool.acquire(),
  release: (ctx) => this.pool.release(ctx),
  dispatch: (ctx) => this.handle(ctx),
}
```

`reset()` zeroes out every field (params back to `EMPTY_PARAMS`, state back
to a fresh `{}`, headers re-bound to the new req, `_written` back to false).
The `state` object is *not* pooled — it's reallocated on reset to avoid
cross-request data leaks if a middleware stashed something.

## Consequences

Positive:
- Allocation pressure on the request thread drops to near-zero for the
  context object itself in steady state. The `state: {}` allocation
  remains (it has to, for safety), but it's a single fresh-empty-object
  which V8 special-cases.
- Hidden-class stability: every `RiftexContext` is constructed once, populated
  the same way every time. V8 keeps them on a single hidden class, which
  is the whole point of "monomorphic" call sites for the dispatcher and
  for user middleware.
- Deterministic memory ceiling. With `poolSize: 1024` the worst case is
  1024 retained contexts plus whatever's in flight. No GC heap surprises
  during traffic spikes.
- The pool is observable and tunable — `poolSize` is a public option, so
  users running latency-critical workloads can size it to their concurrency.

Negative:
- Cross-request data leaks are a real risk if `reset()` ever forgets a
  field. Every new field added to `RiftexContext` requires a corresponding
  reset. We mitigate with a unit test that creates a context, sets every
  public field, calls `reset()`, and asserts every field is back to its
  default. This needs to stay green forever.
- Pool tuning is a footgun. Too small, and high-concurrency loads constantly
  fall back to `new RiftexContext()` (no benefit, slight overhead from the
  pool check). Too large, and you retain memory you don't need. Default
  1024 covers the vast majority of cases.
- The pool makes it tempting to also pool `RiftexBody`, `URLSearchParams`,
  the `state` object, etc. We deliberately did not — pooling `state` is
  a security hazard, pooling `URLSearchParams` is incompatible with the
  WHATWG class semantics, and pooling `RiftexBody` saves a cheap allocation
  in exchange for stream-state bugs.
- A handler that holds a reference to `ctx` past the response (e.g., to
  log async after `next()`) will see that `ctx` mutated mid-flight. This
  is an Express-shaped footgun that pooling makes worse. Documented.

## Alternatives considered

- **Per-request allocation (Express, Hono with Node adapter).** Simpler.
  Costs us hidden-class stability and adds GC pressure. The whole
  performance pitch of RiftExpress depends on us avoiding this.
- **WeakMap-keyed external state.** Keep the framework stateless and store
  per-request data in a `WeakMap<Request, ContextData>`. Slower lookup
  than a property access, no pooling story, and the WeakMap eventually
  GCs the keys with no control. Rejected.
- **Pool only the response side.** Halfway design — pool the writer slots,
  allocate the request side per request. Saves half the allocation, doubles
  the bookkeeping, doesn't actually fix the hidden-class problem because
  the request side is still a fresh object per call. Rejected.
- **Use a `class` extending `Request` (Web standard).** Would be elegant
  for edge runtimes. Doesn't apply to the Node transport, where `req` is
  an `IncomingMessage` and we'd be wrapping anyway.

## Prior art
- Fastify's `Reply` pool — Fastify pre-allocates Reply objects per route
  context for the same reasons. Closest direct prior art.
- Bun's internal request pool — Bun's HTTP server pools its `BunRequest`
  instances; the team has cited GC pressure as the motivation in changelogs.
- `node:undici`'s pool of internal request/response state objects.
- The Linux `slab` allocator and the JVM's `-XX:+UseTLAB` thread-local
  allocation buffers — same idea, applied to objects whose allocation rate
  is predictable and high.
