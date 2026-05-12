import Fastify from 'fastify'

const LAYERS = 10
const app = Fastify({ logger: false })

for (let i = 1; i <= LAYERS; i++) {
  const key = `layer${i}`
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as Record<string, number>)[key] = i
  })
}

app.get('/', async () => ({ ok: true }))

app.listen({ port: 0, host: '127.0.0.1' })
  .then((address) => {
    const port = Number(address.split(':').pop())
    process.stdout.write(`READY:${port}\n`)
  })
  .catch((err) => {
    process.stderr.write(`fastify failed to listen: ${err}\n`)
    process.exit(1)
  })

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
