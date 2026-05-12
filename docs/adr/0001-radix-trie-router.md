# ADR 0001: Radix trie router

## Status
Accepted (2026-05-12)

## Context
Routing is the single hottest piece of code in any HTTP framework — it runs
on every request, before any user logic. RiftExpress's contract (`API.md`)
guarantees:

- Static segments win over `:param` over `*wild` (deterministic precedence).
- Path syntax includes required params (`:id`), optional params (`:id?`),
  and wildcard tails (`*path`).
- 405 responses must include an `Allow` header listing methods registered at
  the matched path.

Express's router is a sorted array of `Layer` objects, each with a
pre-compiled regex. Lookup is `O(n)` linear scan over routes — acceptable for
small apps, painful past a few hundred routes, and impossible to make
allocation-free at request time. Hono ships a "smart router" that picks
between regex, trie, and pattern routers based on registered shape. Fastify
ships `find-my-way`, a radix trie with custom code generation per insert.

We needed a router with these properties:

1. `O(k)` lookup where `k` is the number of path segments — independent of
   how many routes are registered.
2. Deterministic precedence (static > param > wildcard) baked into the data
   structure rather than enforced by sort order at registration.
3. Cheap to introspect for 405 — `Allow` requires knowing the methods at
   the matched leaf without re-walking the tree.
4. No `eval` / `new Function` / runtime code generation — keeps the framework
   compatible with strict CSP, edge runtimes, and any environment where
   dynamic code is forbidden.

## Decision
Implement a hand-written radix trie (`packages/riftexpress/src/router/trie.ts`)
with three child slots per node: a `Map<string, TrieNode>` for static
segments, a single `paramChild` slot, and a single `wildcardChild` slot. The
matcher is iterative (no recursion, no allocation per segment except the
final `params` object) and records wildcard-fallback frames as a stack so we
can backtrack from a dead-end static walk into a `*wild` ancestor.

Per-method composed handlers live at the leaf in `node.handlers[method]`,
which lets `find()` answer "is this method allowed at this path?" in O(1)
once the leaf is reached. `paramNames` is cached on the leaf at insert time
so `find()` builds the params object in `O(k)` without re-walking parents.

## Consequences

Positive:
- Lookup is independent of route count. A 500-route app pays the same per-request
  cost as a 5-route app.
- Precedence is structural — the matcher tries `staticChildren.get(seg)` first,
  then `paramChild`, then `wildcardChild`. There is no precedence sort to get
  wrong, and no way for a user-registered route order to break it.
- 405 with `Allow` header is one `Object.keys(node.handlers)` away — see
  `app.handle` in `packages/riftexpress/src/app.ts` and the `MatchMiss` shape
  in `router/trie.ts`.
- No runtime codegen → works under strict CSP and any future edge target.
- The `EMPTY_PARAMS` frozen-object short-circuit saves one allocation per
  request for parameter-less routes (the common case).

Negative:
- Conflict detection at insert (e.g. `/users/:id` then `/users/:userId` at the
  same level) requires explicit error throws. We do this — see the
  `Conflicting param names at the same trie level` error — but it's not a
  thing find-my-way users have to think about.
- Wildcard backtracking has a worst case where a deeply nested static-then-dead-end
  path triggers fallback rewinding. Not pathological in practice, but it is
  `O(k)` extra in the miss path.
- We hand-rolled the matcher rather than using a battle-tested library, so
  every URL-edge-case bug is ours to find. Mitigated by exhaustive trie tests.

## Alternatives considered

- **Sorted-array linear scan (Express style).** O(n) over routes. Loses badly
  past a few hundred routes and forces every request to allocate match-result
  state for routes it skipped. Rejected.
- **find-my-way fork.** Production-quality and battle-tested. Two reasons we
  passed: (a) it generates code at insert time (`new Function`) which fails
  under strict CSP and is awkward to audit, and (b) it has its own opinions
  about constraint syntax, version handling, and case-sensitivity that we'd
  inherit and would have to fight if they diverged from our contract.
- **Regex matchers (`path-to-regexp`).** One regex per route → still O(n) at
  match time. Worse: regex compilation cost is paid at registration, and the
  regex flavor leaks into the public API forever.
- **Hash table on full path.** Works only for fully static routes; `:param`
  and `*wild` collapse the key. We'd end up with a fallback scanner anyway.
- **Hono's "smart router" approach.** Pick a router per shape. Elegant but
  doubles the surface area we need to test, and the per-shape routers each
  need their own correctness story. Wrong trade-off for v0.0.1.

## Prior art
- Fastify's `find-my-way` — radix trie with codegen per insert.
- Hono's `RegExpRouter` and `TrieRouter` — selected based on registered shape.
- Restana's hand-rolled trie — closest in spirit to ours.
- `koa-tree-router` — radix tree, no codegen.
- The Go `httprouter` library by julienschmidt — original popularizer of the
  three-slot static/param/wildcard trie design that ours descends from.
