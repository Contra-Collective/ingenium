import { ingenium } from 'ingenium'

const LAYERS = 10
const app = ingenium()

for (let i = 1; i <= LAYERS; i++) {
  const key = `layer${i}`
  app.use(async (ctx, next) => {
    ctx.state[key] = i
    await next()
  })
}

app.get('/', () => ({ ok: true }))

const handle = await app.listen(0, '127.0.0.1')
process.stdout.write(`READY:${handle.port}\n`)

process.on('SIGTERM', () => {
  handle.close().finally(() => process.exit(0))
  setTimeout(() => process.exit(0), 1_000).unref()
})
process.on('SIGINT', () => process.exit(0))
