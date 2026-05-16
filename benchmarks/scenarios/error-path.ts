import express, { type NextFunction, type Request, type Response } from 'express'
import { ingenium } from 'ingenium'
import { runBench, printComparison, printHeader } from './_shared.js'

const HOST = '127.0.0.1'
const CONNECTIONS = 100
const DURATION = 10

async function bootExpress(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express()
  app.get('/boom', (_req, _res, next) => {
    next(new Error('boom'))
  })
  // Express error handler — must take 4 args.
  app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'boom' })
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
  app.get('/boom', () => {
    throw new Error('boom')
  })
  app.onError((_err, ctx) => {
    ctx.json({ error: 'boom' }, 500)
  })
  const handle = await app.listen(0, HOST)
  return { port: handle.port, close: handle.close }
}

async function main() {
  printHeader('error-path (GET /boom -> 500 via framework error boundary)', {
    connections: CONNECTIONS,
    duration: DURATION,
  })

  const expressServer = await bootExpress()
  const riftServer = await bootRift()

  try {
    console.log(`Express listening on http://${HOST}:${expressServer.port}`)
    console.log(`Ingenium listening on http://${HOST}:${riftServer.port}`)
    console.log('Running Express benchmark...')
    const expressResult = await runBench({
      url: `http://${HOST}:${expressServer.port}/boom`,
      connections: CONNECTIONS,
      duration: DURATION,
      // Both servers intentionally return 500 — autocannon counts these as
      // non-2xx, that's expected here.
      expectedStatusCode: 500,
    })
    console.log('Running Ingenium benchmark...')
    const riftResult = await runBench({
      url: `http://${HOST}:${riftServer.port}/boom`,
      connections: CONNECTIONS,
      duration: DURATION,
      expectedStatusCode: 500,
    })
    printComparison('error-path', expressResult, riftResult)
  } finally {
    await Promise.allSettled([expressServer.close(), riftServer.close()])
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
