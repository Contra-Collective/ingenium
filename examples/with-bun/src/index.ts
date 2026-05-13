// RiftExpress on Bun.
//
// The framework is transport-agnostic — `riftex({ transport: ... })` lets you
// swap the underlying server. `BunAdapter` runs on `Bun.serve()` instead of
// `node:http`. Same handler surface, same `RiftexContext`, same return-value
// reflection. You must run this file with `bun`, not `node`.

import { riftex } from 'riftexpress'
import { BunAdapter } from 'riftexpress-bun'

const app = riftex({ transport: new BunAdapter() })

app.get('/', () => ({ hello: 'world', runtime: 'bun' }))

app.post('/echo', async (ctx) => {
  const payload = await ctx.body.json<Record<string, unknown>>()
  return { youSent: payload }
})

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}  (Bun)`)
