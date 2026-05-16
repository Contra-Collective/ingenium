// Ingenium on Bun.
//
// The framework is transport-agnostic — `ingenium({ transport: ... })` lets you
// swap the underlying server. `BunAdapter` runs on `Bun.serve()` instead of
// `node:http`. Same handler surface, same `IngeniumContext`, same return-value
// reflection. You must run this file with `bun`, not `node`.

import { ingenium } from 'ingenium'
import { BunAdapter } from 'ingenium-bun'

const app = ingenium({ transport: new BunAdapter() })

app.get('/', () => ({ hello: 'world', runtime: 'bun' }))

app.post('/echo', async (ctx) => {
  const payload = await ctx.body.json<Record<string, unknown>>()
  return { youSent: payload }
})

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}  (Bun)`)
