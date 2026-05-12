# Example: RiftExpress on Bun

A minimal RiftExpress server that uses `BunAdapter` instead of the default
Node `http` transport. Same routes, same handlers, same `ctx` — only the
underlying server changes.

## Requirements

- **Bun >= 1.1.0** ([install](https://bun.sh)). This example is intentionally
  Bun-only and will not fall back to Node — `BunAdapter` throws at startup
  if `Bun` isn't defined in the global scope. If you want Node, use the
  default transport (the [`basic` example](../basic)).

## Run

```sh
bun install
bun run start
```

Then:

```sh
curl http://localhost:3000/
curl -X POST -H "content-type: application/json" \
  -d '{"hello":"bun"}' http://localhost:3000/echo
```

## Why a separate transport?

`Bun.serve()` uses the WinterCG `Request` / `Response` shape, not Node's
`IncomingMessage` / `ServerResponse`. `BunAdapter` translates between the
two so the framework's pooled `RexContext` and lazy body parsers work
unchanged. See [`packages/riftexpress-bun`](../../packages/riftexpress-bun)
for the adapter source and known limitations.
