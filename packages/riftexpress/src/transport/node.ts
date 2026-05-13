import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { RiftexContext } from '../context/context.ts'
import type { HttpMethod } from '../router/types.ts'
import { createByteLimit } from '../body/limit.ts'
import type { CloseOptions, ListeningServer, Transport, TransportHooks } from './types.ts'

/**
 * Node.js `node:http` transport. Owns a single `http.Server`; on each
 * request, populates a pooled `RiftexContext` directly from the
 * `IncomingMessage` (no WinterCG translation), awaits dispatch, then writes
 * the context's response state to the `ServerResponse`.
 */
export class NodeAdapter implements Transport {
  private hooks: TransportHooks | null = null

  attach(hooks: TransportHooks): void {
    this.hooks = hooks
  }

  async listen(port: number, host = '127.0.0.1'): Promise<ListeningServer> {
    if (!this.hooks) throw new Error('NodeAdapter.listen() called before attach()')
    const hooks = this.hooks

    const server = createServer((req, res) => {
      handleRequest(req, res, hooks).catch((err) => {
        // Last-resort safety net — the dispatch loop should have caught everything.
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }))
        } else {
          res.end()
        }
        process.emitWarning(`riftexpress: dispatch leaked: ${(err as Error).message ?? String(err)}`)
      })
    })

    // Track every open socket so close() can drain (and, if asked, force-kill)
    // idle keep-alive connections that `server.close()` alone would leave open.
    const sockets = new Set<Socket>()
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })

    return new Promise<ListeningServer>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to determine bound address'))
          return
        }
        resolve({
          port: addr.port,
          host: addr.address,
          close: (opts?: CloseOptions) =>
            new Promise<void>((res, rej) => {
              let settled = false
              let timer: NodeJS.Timeout | null = null

              server.close((err) => {
                if (timer) clearTimeout(timer)
                if (settled) return
                settled = true
                err ? rej(err) : res()
              })

              const timeoutMs = opts?.gracefulTimeoutMs
              if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)) {
                timer = setTimeout(() => {
                  // Force-close any sockets still hanging around (idle
                  // keep-alives or slow handlers). server.close()'s callback
                  // will fire once they're destroyed.
                  for (const socket of sockets) socket.destroy()
                }, Math.max(0, timeoutMs))
                // Don't keep the event loop alive just for the force-close timer.
                if (typeof timer.unref === 'function') timer.unref()
              }
            }),
        })
      })
    })
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, hooks: TransportHooks): Promise<void> {
  // Normalize once: TransportHooks types maxRequestBytes as optional for
  // backward-compat; framework dispatch always sets it. Older fixtures may
  // not — treat undefined as "no cap" (Infinity).
  const maxBytes = hooks.maxRequestBytes ?? Number.POSITIVE_INFINITY

  // Content-Length pre-check: if the client declares a body larger than the
  // ceiling, reject IMMEDIATELY without acquiring a context or buffering
  // anything. Chunked requests (no Content-Length) and Content-Length: 0
  // fall through to the byte-limit Transform below, which catches
  // mid-stream overruns.
  if (rejectIfContentLengthTooBig(req, res, maxBytes)) return

  const ctx = hooks.acquire()
  try {
    populateContext(ctx, req, maxBytes)
    await hooks.dispatch(ctx)
    writeResponse(ctx, res)
  } finally {
    hooks.release(ctx)
  }
}

/**
 * Returns `true` (and writes a 413 response) if the request advertises a
 * Content-Length greater than `maxRequestBytes`. Returns `false` for missing,
 * invalid, or in-range Content-Length values — those cases are handled by
 * the byte-limit Transform downstream.
 */
function rejectIfContentLengthTooBig(
  req: IncomingMessage,
  res: ServerResponse,
  maxRequestBytes: number,
): boolean {
  if (!Number.isFinite(maxRequestBytes)) return false
  const raw = req.headers['content-length']
  if (typeof raw !== 'string' || raw.length === 0) return false
  const n = Number(raw)
  if (!Number.isFinite(n)) return false
  if (n <= maxRequestBytes) return false

  res.statusCode = 413
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('connection', 'close')
  res.end(
    JSON.stringify({
      error: `Request body exceeded ${maxRequestBytes} bytes`,
      code: 'PAYLOAD_TOO_LARGE',
    }),
  )
  // Hint the kernel to drop any pending body bytes; we never read them.
  req.socket?.destroy()
  return true
}

function populateContext(ctx: RiftexContext, req: IncomingMessage, maxRequestBytes: number): void {
  ctx.method = (req.method ?? 'GET') as HttpMethod
  ctx.url = req.url ?? '/'
  // Split path / query without allocating a URL object.
  const url = ctx.url
  const qIdx = url.indexOf('?')
  if (qIdx >= 0) {
    ctx.path = url.slice(0, qIdx)
    ctx.rawQuery = url.slice(qIdx + 1)
  } else {
    ctx.path = url
    ctx.rawQuery = ''
  }
  ctx.headers = req.headers
  ctx.remoteAddress = req.socket?.remoteAddress ?? '127.0.0.1'
  // Detect TLS via the socket's `encrypted` flag (set by tls.TLSSocket).
  ctx.baseProtocol = (req.socket as { encrypted?: boolean })?.encrypted ? 'https' : 'http'

  // Wire body lazily — the source stream is only consumed if a body method is called.
  const cl = req.headers['content-length']
  const contentLength = cl ? Number(cl) : undefined
  const ct = req.headers['content-type']
  // Wrap the raw IncomingMessage in a transport-level byte-limit so the cap
  // applies to EVERY consumer, including `ctx.body.stream()`. Skip the wrap
  // when the cap is disabled (Infinity) OR when the request is structurally
  // body-less (GET/HEAD/OPTIONS or explicit Content-Length: 0). The Transform
  // is the single biggest per-request overhead on hot read endpoints; not
  // installing it for body-less methods clawed back ~10-15% of hello-rps.
  const noBody =
    contentLength === 0 ||
    ctx.method === 'GET' ||
    ctx.method === 'HEAD' ||
    ctx.method === 'OPTIONS'
  const source =
    noBody || !Number.isFinite(maxRequestBytes)
      ? req
      : req.pipe(createByteLimit(maxRequestBytes))
  ctx.body._attach(source, ct, Number.isFinite(contentLength) ? contentLength : undefined)
}

function writeResponse(ctx: RiftexContext, res: ServerResponse): void {
  res.statusCode = ctx._statusCode

  for (const name in ctx._headers) {
    const value = ctx._headers[name]
    if (value !== undefined) res.setHeader(name, value)
  }

  const body = ctx._body
  switch (body.kind) {
    case 'none':
      res.end()
      break
    case 'string':
      // Set content-length when we know it; lets keep-alive reuse the connection.
      if (!res.hasHeader('content-length')) {
        res.setHeader('content-length', Buffer.byteLength(body.data))
      }
      res.end(body.data)
      break
    case 'buffer':
      if (!res.hasHeader('content-length')) {
        res.setHeader('content-length', body.data.length)
      }
      res.end(body.data)
      break
    case 'stream':
      body.data.pipe(res)
      break
  }
}
