# ingenium-bun

A `Bun.serve()` transport adapter for [Ingenium](../ingenium). Lets you
run a Ingenium app on the Bun runtime instead of `node:http`, with the
same handler surface and the same per-request `IngeniumContext`.

## Install

```sh
bun add ingenium ingenium-bun
```

## Use

```ts
import { ingenium } from 'ingenium'
import { BunAdapter } from 'ingenium-bun'

const app = ingenium({ transport: new BunAdapter() })

app.get('/', () => ({ hello: 'world' }))
app.get('/users/:id', (ctx) => ({ id: ctx.params.id }))

await app.listen(3000)
```

Run with:

```sh
bun run server.ts
```

## How it works

On each request, the adapter:

1. Acquires a pooled `IngeniumContext` from the framework.
2. Populates it from the WinterCG `Request` (method, url, path, rawQuery,
   headers, and a lazy body bridge — the body is only consumed if your
   handler calls `ctx.body.*`).
3. Awaits `app.handle(ctx)`.
4. Builds a `Response` from the context's status, headers, and body kind.
   Streamed bodies are converted from `node:stream` `Readable` back to a
   WinterCG `ReadableStream` via `Readable.toWeb`.

## Known limitations

- Handlers that rely on Node-only stream APIs (e.g. `.unshift`, raw socket
  access, `IncomingMessage` quirks) may behave differently under Bun.
- `req.body` is exposed as a Node `Readable` for compatibility with the rest
  of Ingenium, but the underlying source is a WinterCG stream — performance
  characteristics differ slightly from the `node:http` transport.
- Trailers and HTTP/2 push are not supported (Bun limitation).
