import { riftex } from 'riftexpress'

const app = riftex()
app.post('/echo', async (ctx) => {
  const body = await ctx.body.json<{ name?: string }>()
  return { name: body?.name, processedAt: Date.now() }
})

const handle = await app.listen(0, '127.0.0.1')
process.stdout.write(`READY:${handle.port}\n`)

process.on('SIGTERM', () => {
  handle.close().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 1_000).unref()
})
process.on('SIGINT', () => process.exit(0))
