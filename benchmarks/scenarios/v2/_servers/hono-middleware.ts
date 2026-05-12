import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const LAYERS = 10
const app = new Hono()

for (let i = 1; i <= LAYERS; i++) {
  const key = `layer${i}`
  app.use(async (c, next) => {
    c.set(key as never, i as never)
    await next()
  })
}

app.get('/', (c) => c.json({ ok: true }))

const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
  process.stdout.write(`READY:${info.port}\n`)
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1_000).unref()
})
process.on('SIGINT', () => process.exit(0))
