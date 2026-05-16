import Fastify from 'fastify'

const app = Fastify({ logger: false })
app.post('/echo', async (req) => {
  const body = req.body as { name?: string } | undefined
  return { name: body?.name, processedAt: Date.now() }
})

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
