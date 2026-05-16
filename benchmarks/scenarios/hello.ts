import express from 'express'
import { ingenium } from 'ingenium'
import { runBench, printComparison, printHeader } from './_shared.js'

const HOST = '127.0.0.1'
const CONNECTIONS = 100
const DURATION = 10

async function bootExpress(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express()
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
  const app = ingenium()
  app.get('/', () => ({ ok: true }))
  const handle = await app.listen(0, HOST)
  return { port: handle.port, close: handle.close }
}

async function main() {
  printHeader('hello (GET / -> {ok:true})', { connections: CONNECTIONS, duration: DURATION })

  const expressServer = await bootExpress()
  const riftServer = await bootRift()

  try {
    console.log(`Express listening on http://${HOST}:${expressServer.port}`)
    console.log(`Ingenium listening on http://${HOST}:${riftServer.port}`)
    console.log('Running Express benchmark...')
    const expressResult = await runBench({
      url: `http://${HOST}:${expressServer.port}/`,
      connections: CONNECTIONS,
      duration: DURATION,
    })
    console.log('Running Ingenium benchmark...')
    const riftResult = await runBench({
      url: `http://${HOST}:${riftServer.port}/`,
      connections: CONNECTIONS,
      duration: DURATION,
    })
    printComparison('hello', expressResult, riftResult)
  } finally {
    await Promise.allSettled([expressServer.close(), riftServer.close()])
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
