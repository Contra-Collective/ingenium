# RiftExpress Public API Contract (v0.0.1)

This is the locked public API for downstream code (tests, compat shim, examples, benchmarks, docs). If you find a gap in this spec while implementing, **stop and ask**, do not invent an API.

## Imports

```ts
import {
  rex,                       // function: creates RexApp
  Router,                    // function: creates a mountable Router
  RexContext,                // class
  RexBody,                   // class (on ctx.body)
  RexError,
  RexNotFoundError,
  RexUnauthorizedError,
  RexMethodNotAllowedError,
  RexPayloadTooLargeError,
  RexValidationError,
  RexBadRequestError,
  type RexHandler,
  type RexMiddleware,
  type ExtractParams,
  type HttpMethod,
} from 'riftexpress'
```

## App

```ts
const app = rex({ poolSize?: number })

app.use(mw: RexMiddleware): this
app.use(mountPath: string, mw: RexMiddleware | Router): this

app.get(path, handler)
app.post(path, handler)
app.put(path, handler)
app.patch(path, handler)
app.delete(path, handler)
app.head(path, handler)
app.options(path, handler)

app.onError((err: unknown, ctx: RexContext) => unknown | Promise<unknown>): this
app.compose(): void                       // explicit pre-warm; auto-runs lazily on first request
app.handle(ctx: RexContext): Promise<void>  // dispatch entry, used by adapters
app.listen(port: number, host?: string): Promise<{ port: number; close: () => Promise<void> }>

// Built-in middleware (no install required):
rex.json(opts?:    { limit?: number }): RexMiddleware     // sets ctx.body parsing default
rex.urlencoded(opts?: { limit?: number }): RexMiddleware
// Note: these are zero-cost no-ops in v0.0.1 — body parsing is lazy via
// `ctx.body.json()` / `ctx.body.urlencoded()`. Provided for Express
// migration ergonomics so existing `app.use(express.json())` lines compile.
```

## Router

```ts
const r = Router()
r.get(path, handler)         // same surface as app
r.use(mw)
r.use(mountPath, mw | Router)

app.use('/api', r)           // mounts at /api — routes inside r get the prefix
```

## RexContext

```ts
class RexContext<Params = Record<string, string>> {
  // Request
  method: HttpMethod
  url: string                 // path + ?query
  path: string                // no query
  rawQuery: string            // raw query string
  query: URLSearchParams      // lazy parsed
  params: Params
  headers: IncomingHttpHeaders
  body: RexBody
  state: Record<string, unknown>  // free-form per-request scratch

  // Response setters (chainable: status, set/setHeader)
  status(code: number): this
  set(name: string, value: string | string[]): this
  setHeader(name: string, value: string | string[]): this
  getHeader(name: string): string | string[] | undefined

  // Response writers (terminal — sets _written)
  json(body: unknown, status?: number): void
  text(body: string, status?: number): void
  html(body: string, status?: number): void
  send(body: Buffer | string, status?: number): void
  redirect(location: string, status?: number): void   // default 302
  stream(readable: Readable, contentType?: string): void
}
```

## RexBody

```ts
class RexBody {
  json<T>(schema?: ZodLikeSchema<T>, maxBytes?: number): Promise<T>
  text(maxBytes?: number): Promise<string>
  urlencoded(maxBytes?: number): Promise<Record<string, string>>
  buffer(maxBytes?: number): Promise<Buffer>           // default limit 1 MiB
  stream(): Readable                                    // raw node:stream Readable
}
// Schema may be Zod (uses safeParse) or any { parse(input): T } compatible.
// Validation failure throws RexValidationError with field-level `fields`.
```

## Middleware

```ts
type RexMiddleware = (ctx: RexContext, next: () => Promise<void>) => unknown | Promise<unknown>
type RexHandler<P = Record<string, string>> = (ctx: RexContext<P>) => unknown | Promise<unknown>
```

Handler return values are reflected to the wire:
- `undefined` + `_written === false` → 204 No Content
- `string` starting with `<` → 200 text/html
- other `string` → 200 text/plain
- `Buffer` / `Uint8Array` → 200 application/octet-stream
- `Readable` → 200 streamed
- any object → 200 application/json
- If `ctx.json/text/html/stream/redirect/send` was called, return value is ignored.

## Errors

All extend `RexError`. Default boundary serializes:
```json
{ "error": "<message>", "code": "<CODE>", "fields"?: { ... } }
```

`onError(handler)` overrides; re-throw to delegate to the default.

## Composition lifecycle

- Registration order is journaled, NOT eagerly composed.
- First request (or explicit `app.compose()`) triggers composition of every leaf.
- Any registration after composition sets a dirty flag → next request recomposes.
- This is NOT frozen-after-listen; tests that register routes after `listen()` work.

## Path syntax

- `/users/:id` — required param
- `/users/:id?` — optional param
- `/files/*path` — wildcard tail
- Static segments win over `:param` over `*wild` (deterministic precedence).

## Files an agent MAY NOT touch

These are owned by the main thread:
- `packages/riftexpress/src/**`  (core sources)
- `packages/riftexpress/package.json`, `tsconfig.json`, `tsup.config.ts`
- root `package.json`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`
- `API.md` (this file)

Agents MAY create any new files under their assigned directories.
