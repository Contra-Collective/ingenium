import { describe, it, expect, beforeAll } from 'vitest'
import { ingenium } from '../src/index.ts'
import { enableWebSockets } from '../src/ws/index.ts'
import type { ListeningServer } from '../src/transport/types.ts'

// Probe for the optional `ws` peer dep at module load. Tests run only when
// it's installed; otherwise the whole suite is skipped (matches the
// peer-dep-optional design — CI installs `ws` as a devDep so the suite runs).
let hasWs = false
try {
  await import('ws')
  hasWs = true
} catch {
  hasWs = false
}

// Minimal subset of the `ws.WebSocket` API we touch in this test file.
type WsClient = {
  on(event: 'open', listener: () => void): void
  on(event: 'message', listener: (data: Buffer) => void): void
  on(event: 'close', listener: (code: number) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  send(data: string | Buffer): void
  close(): void
}

interface WsModuleLike {
  WebSocket: new (url: string) => WsClient
}

let WS: WsModuleLike

beforeAll(async () => {
  if (!hasWs) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('ws')
  WS = { WebSocket: mod.WebSocket ?? mod.default ?? mod }
})

function connect(url: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const c = new WS.WebSocket(url)
    c.on('open', () => resolve(c))
    c.on('error', reject)
  })
}

function once<T = Buffer>(c: WsClient, event: 'message' | 'close'): Promise<T> {
  return new Promise((resolve) => {
    // ws's overloaded `on` doesn't accept a generic union of event names cleanly;
    // this cast is contained to the test helper.

    ;(c as unknown as { on(e: string, cb: (data: T) => void): void }).on(event, (data: T) => resolve(data))
  })
}

describe.skipIf(!hasWs)('ingenium/ws', () => {
  it('echoes messages on app.ws("/echo", ...)', async () => {
    const app = ingenium()
    enableWebSockets(app)
    app.ws('/echo', (sock) => {
      sock.on('message', (m) => sock.send(m))
    })

    const server: ListeningServer = await app.listen(0)
    try {
      const client = await connect(`ws://127.0.0.1:${server.port}/echo`)
      const echoed = once<Buffer>(client, 'message')
      client.send('ping')
      const data = await echoed
      expect(data.toString()).toBe('ping')
      client.close()
    } finally {
      await server.close({ gracefulTimeoutMs: 100 })
    }
  })

  it('routes multiple paths independently', async () => {
    const app = ingenium()
    enableWebSockets(app)
    app
      .ws('/a', (sock) => sock.send('A'))
      .ws('/b', (sock) => sock.send('B'))

    const server = await app.listen(0)
    try {
      // The handlers above push a message on upgrade — server-initiated.
      // We MUST attach the 'message' listener at construction time, before
      // the socket reaches OPEN, because `ws` (unlike browser WebSocket)
      // does not buffer messages that arrive before a listener exists.
      // Pattern: build the WebSocket, attach handlers synchronously, then
      // wrap in a Promise that resolves on the first message.
      const collect = (url: string): Promise<Buffer> =>
        new Promise((resolve, reject) => {
          const c = new WS.WebSocket(url)
          c.on('message', (m: Buffer) => {
            resolve(m)
            c.close()
          })
          c.on('error', reject)
        })

      const [aMsg, bMsg] = await Promise.all([
        collect(`ws://127.0.0.1:${server.port}/a`),
        collect(`ws://127.0.0.1:${server.port}/b`),
      ])
      expect(aMsg.toString()).toBe('A')
      expect(bMsg.toString()).toBe('B')
    } finally {
      await server.close({ gracefulTimeoutMs: 100 })
    }
  })

  it('destroys the socket on unknown path (no handler => close)', async () => {
    const app = ingenium()
    enableWebSockets(app)
    app.ws('/known', () => { /* never reached in this test */ })

    const server = await app.listen(0)
    try {
      // The connection attempt should fail (server destroys the socket
      // before completing the handshake). Either an `error` event or an
      // immediate `close` is acceptable; we just need the open event NOT
      // to fire.
      const result = await new Promise<'opened' | 'rejected'>((resolve) => {
        const c = new WS.WebSocket(`ws://127.0.0.1:${server.port}/missing`)
        c.on('open', () => resolve('opened'))
        c.on('error', () => resolve('rejected'))
        c.on('close', () => resolve('rejected'))
      })
      expect(result).toBe('rejected')
    } finally {
      await server.close({ gracefulTimeoutMs: 100 })
    }
  })

  it('app.close() tears down the WebSocketServer cleanly', async () => {
    const app = ingenium()
    enableWebSockets(app)
    app.ws('/echo', (sock) => {
      sock.on('message', (m) => sock.send(m))
    })

    const server = await app.listen(0)
    const client = await connect(`ws://127.0.0.1:${server.port}/echo`)
    const closed = once<number>(client, 'close')

    // Should resolve in <1s — the registrar terminates clients on close.
    const closeStart = Date.now()
    await server.close({ gracefulTimeoutMs: 500 })
    const closeMs = Date.now() - closeStart
    expect(closeMs).toBeLessThan(2000)

    // The client should have observed the close.
    await closed
  })
})
