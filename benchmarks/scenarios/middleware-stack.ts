import express from 'express'
import { rex } from 'riftexpress'
import { runBench, printComparison, printHeader } from './_shared.js'

const HOST = '127.0.0.1'
const CONNECTIONS = 100
const DURATION = 10
const LAYERS = 10

async function bootExpress(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express()
  for (let i = 1; i <= LAYERS; i++) {
    const key = `layer${i}`
    app.use((req, _res, next) => {
      ;(req as unknown as Record<string, number>)[key] = i
      next()
    })
  }
  app.get('/', (_req, res) => {
    res.json({ ok: true })
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
  for (let i = 1; i <= LAYERS; i++) {
    const key = `layer${i}`
    app.use(async (ctx, next) => {
      ctx.state[key] = i
      await next()
    })
  }
  app.get('/', () => ({ ok: true }))
  const handle = await app.listen(0, HOST)
  return { port: handle.port, close: handle.close }
}

async function main() {
  printHeader(`middleware-stack (${LAYERS} mw layers)`, {
    connections: CONNECTIONS,
    duration: DURATION,
  })

  const expressServer = await bootExpress()
  const riftServer = await bootRift()

  try {
    console.log(`Express listening on http://${HOST}:${expressServer.port}`)
    console.log(`RiftExpress listening on http://${HOST}:${riftServer.port}`)
    console.log('Running Express benchmark...')
    const expressResult = await runBench({
      url: `http://${HOST}:${expressServer.port}/`,
      connections: CONNECTIONS,
      duration: DURATION,
    })
    console.log('Running RiftExpress benchmark...')
    const riftResult = await runBench({
      url: `http://${HOST}:${riftServer.port}/`,
      connections: CONNECTIONS,
      duration: DURATION,
    })
    printComparison(`middleware-stack (${LAYERS} layers)`, expressResult, riftResult)
  } finally {
    await Promise.allSettled([expressServer.close(), riftServer.close()])
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
