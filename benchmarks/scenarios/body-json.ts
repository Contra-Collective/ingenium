import express from 'express'
import { rex } from 'riftexpress'
import { runBench, printComparison, printHeader } from './_shared.js'

const HOST = '127.0.0.1'
const CONNECTIONS = 100
const DURATION = 10

async function bootExpress(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express()
  app.use(express.json())
  app.post('/echo', (req, res) => {
    const body = req.body as { name?: string }
    res.json({ name: body?.name, processedAt: Date.now() })
  })
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, HOST, () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind express ephemeral port'))
        return
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((res2, rej2) =>
            server.close((err) => (err ? rej2(err) : res2()))
          ),
      })
    })
    server.once('error', reject)
  })
}

async function bootRift(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = rex()
  app.post('/echo', async (ctx) => {
    const body = await ctx.body.json<{ name?: string }>()
    return { name: body?.name, processedAt: Date.now() }
  })
  const handle = await app.listen(0, HOST)
  return { port: handle.port, close: handle.close }
}

async function main() {
  printHeader('body-json (POST /echo with JSON body)', {
    connections: CONNECTIONS,
    duration: DURATION,
  })

  const expressServer = await bootExpress()
  const riftServer = await bootRift()

  const body = JSON.stringify({ name: 'world' })
  const headers = { 'content-type': 'application/json' }

  try {
    console.log(`Express listening on http://${HOST}:${expressServer.port}`)
    console.log(`RiftExpress listening on http://${HOST}:${riftServer.port}`)
    console.log('Running Express benchmark...')
    const expressResult = await runBench({
      url: `http://${HOST}:${expressServer.port}/echo`,
      method: 'POST',
      body,
      headers,
      connections: CONNECTIONS,
      duration: DURATION,
    })
    console.log('Running RiftExpress benchmark...')
    const riftResult = await runBench({
      url: `http://${HOST}:${riftServer.port}/echo`,
      method: 'POST',
      body,
      headers,
      connections: CONNECTIONS,
      duration: DURATION,
    })
    printComparison('body-json', expressResult, riftResult)
  } finally {
    await Promise.allSettled([expressServer.close(), riftServer.close()])
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
