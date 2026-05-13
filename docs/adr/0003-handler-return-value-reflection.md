# ADR 0003: Handler return-value reflection

## Status
Accepted (2026-05-12)

## Context
Express handlers must call `res.send()`, `res.json()`, etc. to write a
response. Forgetting to do so is the canonical Express bug — the request
hangs until the client times out, with no error logged. The signature
`(req, res, next) => void` makes "return a value" non-obvious because the
return is structurally meaningless.

Modern frameworks have moved on. Hono handlers return a `Response`
object. Elysia handlers return whatever and the framework reflects it. Koa
handlers set `ctx.body`. The common thread: *the handler's return value
carries response semantics*.

API.md fixes this contract precisely:

```
- `undefined` + `_written === false` → 204 No Content
- `string` starting with `<` → 200 text/html
- other `string` → 200 text/plain
- `Buffer` / `Uint8Array` → 200 application/octet-stream
- `Readable` → 200 streamed
- any object → 200 application/json
- If `ctx.json/text/html/stream/redirect/send` was called, return value is ignored.
```

The escape hatch — `ctx.json(...)` etc. still work and override the return
value — exists for two reasons: (1) Express migrators paste old code that
calls `res.json()` and it should keep working, and (2) handlers sometimes
need to set status/headers and return the body, which is awkward if the
return is the only output channel.

The reflection itself lives in `packages/riftexpress/src/response/reflect.ts`
and is invoked by the terminal middleware in `composeWithHandler` (see
`middleware/compose.ts`):

```ts
const terminal: RiftexMiddleware = async (ctx) => {
  const result = await handler(ctx)
  reflectReturn(ctx, result)
}
```

## Decision
Handlers may return any value. After the handler resolves, the framework
inspects `ctx._written` (set by every terminal helper) and, if false,
inspects the return value to pick a Content-Type, status, and serialization
strategy per the table above. If `_written` is true the return value is
discarded — the user's explicit `ctx.send(...)` call wins.

## Consequences

Positive:
- The most common handler — "return a JSON object" — becomes
  `app.get('/', () => ({ ok: true }))`. No `res` parameter, no `.json()` call.
  This is the hello-world ergonomic gain that drives the whole library.
- Type-safety improves: a handler typed `() => User` actually returns the
  shape the client gets. With `(req, res) => void` you have to read the
  body of the function to know.
- The "forgot to call `res.send`" bug class is eliminated for handlers that
  return a value. (You can still hang the request by returning `undefined`
  and not calling `ctx.send` — that produces a 204, which is correct.)
- Streaming, redirects, and Buffer responses all flow through one consistent
  shape. The terminal helpers (`ctx.stream`, `ctx.redirect`) exist for the
  cases where you want imperative control.

Negative:
- Reflection has a small runtime cost per request — a `typeof` check, an
  `instanceof Buffer` check, and an `instanceof Readable` check. Measured
  to be sub-microsecond but not free. The compose layer pays this on every
  request, even handlers that called `ctx.send` (we still inspect
  `_written` to decide). We considered short-circuiting in the terminal
  middleware but the conditional was more expensive than the type checks
  on the hot path.
- The contract has six branches. Users have to learn it. Mitigated by:
  the table is the entire contract (no hidden cases), and the helpers
  (`ctx.json`, `ctx.text`, `ctx.html`) exist for users who prefer explicit.
- "string starts with `<`" is heuristic HTML detection. We picked this over
  forcing users to wrap in a `Html` tag because (a) it matches Hono's
  behavior and (b) the alternative — always treating string as text/plain
  — would silently break templates. Documented heuristics beat magic.
- The escape hatch (`_written` overrides return) means a handler that does
  *both* (`ctx.json({...}); return otherThing`) silently drops `otherThing`.
  This is the right behavior but it surprises people. We decided not to
  warn — adding a console.warn on the hot path is worse than the surprise.

## Alternatives considered

- **Express-style `(req, res)` only.** Zero migration breakage but throws
  away the headline DX win. Rejected — this would make the library
  pointless.
- **Hono-style `Response` only.** Force handlers to construct and return a
  WHATWG `Response`. Clean model, future-proof for edge runtimes, but a
  hard break from Express muscle memory and forces wrapping for the 90%
  case where the user just wants a JSON object. The `RiftexContext` design
  also gives us per-request state and headers in one place; a `Response`
  return loses that.
- **Koa-style `ctx.body = value`.** Halfway house — return value ignored,
  user assigns to `ctx.body`. Less ergonomic than direct return for
  one-liners, more verbose, gains nothing the helpers don't already
  provide. Rejected.
- **Reflection only when no helper was called and return is non-undefined.**
  Same end result, slightly slower hot path. Current behavior wins.

## Prior art
- Hono — handlers return `Response`. Different in shape, same philosophy.
- Elysia — return-value reflection nearly identical to ours.
- Koa — `ctx.body = value` and the framework serializes. Same idea, different
  channel.
- Polka — Express-style only. The lack of return-value reflection is part of
  why Polka feels older despite being faster than Express.
- AWS Lambda Node handlers — `return { statusCode, body }`. Same conceptual
  move, applied to serverless.
