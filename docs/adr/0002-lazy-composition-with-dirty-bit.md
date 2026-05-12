# ADR 0002: Lazy composition with a dirty bit

## Status
Accepted (2026-05-12)

## Context
RiftExpress separates *registration* (you call `app.use(...)` and `app.get(...)`)
from *composition* (the framework walks the registration journal, figures out
which middleware applies to which leaf route, and produces a single
pre-bound async function per (method, path) tuple).

This separation is the source of our middleware-stack performance: the hot
path runs `composed(ctx)` and nothing else — no per-request `bind`, no index
variable, no `stack[n]` lookups (see `middleware/compose.ts`). But it forces
a question: *when* does composition run?

Constraints from `API.md`:

- "Registration order is journaled, NOT eagerly composed."
- "First request (or explicit `app.compose()`) triggers composition of every leaf."
- "Any registration after composition sets a dirty flag → next request recomposes."
- "This is NOT frozen-after-listen; tests that register routes after `listen()` work."

The last constraint is the load-bearing one. Vitest specs commonly do
`await app.listen(0)` and then mutate routes inside `beforeEach`. A
freeze-on-listen design would break every one of those tests and force users
to discover, in production, that they accidentally registered a route too late.

## Decision
Defer composition until the first request reaches `app.handle()`. Track a
single `dirty: boolean` field on `RexApp` (see `packages/riftexpress/src/app.ts`).
Set it `true` in the `RexApp` constructor and on every `use()`, `method()`,
`get()`/`post()`/etc. call. At the top of `handle()`:

```ts
async handle(ctx: RexContext): Promise<void> {
  if (this.dirty) this.compose()
  // ...
}
```

`compose()` rebuilds the trie from scratch — flatten the router, re-walk
every registered route, recompute `applicable` middleware per route, build
a fresh `RouterTrie` and replace `this.trie` atomically. Then clear
`this.dirty`.

## Consequences

Positive:
- Test ergonomics match developer intuition. Add a route after listen, the
  next request sees it. No "you must call X first" footgun.
- Cold start is amortized — registration is `O(1) per call`; composition pays
  once, on the request thread, on the first hit.
- `compose()` is also exported as a public method so production deployments
  that care about cold-start latency can pre-warm before binding the port.
  We do this in `listen()` already as a courtesy: `if (this.dirty) this.compose()`
  runs before `transport.listen`.
- Atomicity: `this.trie = trie` is a single property assignment, observable
  to every in-flight request as either the old or the new trie, never a
  half-built one. JavaScript's single-threaded execution gives us this for free.

Negative:
- A registration burst after the first request triggers a full recompose on
  the *next* request, which can cause a visible latency spike. In practice
  the registration journal is small (tens to low hundreds of routes) and
  composition is fast (a few ms), but it's worth knowing.
- The dirty bit is a single flag — we recompose *everything* even if only
  one route was added. A more sophisticated design would do incremental
  insert/recompose for the affected leaves. We chose simplicity.
- Reading `compose()` requires understanding that it allocates a fresh
  `RouterTrie`. If anyone holds a reference to the old trie, they're now
  reading stale data. We keep the trie internal and never expose it.

## Alternatives considered

- **Freeze on listen (Koa, Express in spirit).** Simpler internal model, no
  dirty bit, no recompose. Rejected because it breaks the "register routes
  after `listen()` in tests" use case explicitly preserved by API.md.
- **Eager compose on every registration.** Every `app.get(...)` would
  flatten and rebuild. This is `O(routes^2)` to register a full app, and
  pointless — the caller will register more routes before the first request.
  Rejected as wasteful.
- **Per-request composition.** No upfront cost, no dirty bit, but every
  request pays the flatten + walk + composeWithHandler tax. Slow and stupid.
  Rejected.
- **Incremental recompose (only re-do affected leaves).** The right answer
  if recompose latency ever becomes a bottleneck. Deferred — current
  recompose is fast enough that the engineering cost of getting incremental
  correct (especially around `flat.scopedMiddleware`'s `pathStartsWith`
  behavior) doesn't pay back yet.
- **`Object.freeze(app)` on listen with an opt-out.** API surface bloat. The
  dirty-bit design gives us the same end result (you can still re-register)
  without an extra knob.

## Prior art
- Fastify's `onRoute` and `onReady` lifecycle hooks — Fastify is closer to
  freeze-on-listen and uses lifecycle hooks to give users a window to
  finalize registrations. We chose deferred-recompose instead because it's
  invisible to users.
- Express's `Router#stack` — re-evaluated on every request, no compose phase.
  Conceptually the opposite of our approach.
- Koa's `compose(middleware)` — exported as a function, called once at
  `app.callback()` time, frozen thereafter. Closer to "freeze on first use".
- The Linux kernel's RCU pattern — replace a pointer atomically, let readers
  see either old or new. Same idea, less ceremony, because JS is single-threaded.
