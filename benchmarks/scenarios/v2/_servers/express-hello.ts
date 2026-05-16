import express from 'express'

const app = express()
app.get('/', (_req, res) => {
  res.json({ ok: true })
})

const server = app.listen(0, '127.0.0.1', () => {
  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    process.stderr.write('failed to bind ephemeral port\n')
    process.exit(1)
  }
  process.stdout.write(`READY:${addr.port}\n`)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
