import {
  createServer as createH2cServer,
  createSecureServer as createH2Server,
  constants as h2,
  type Http2SecureServer,
  type Http2Server,
  type ServerHttp2Stream,
  type IncomingHttpHeaders as Http2IncomingHeaders,
  type Http2ServerRequest,
  type Http2ServerResponse,
} from 'node:http2'
import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import type { IncomingHttpHeaders } from 'node:http'
import type { HttpMethod } from '../router/types.ts'
import type {
  CloseOptions,
  ListeningServer,
  Transport,
  TransportHooks,
} from './types.ts'
import { populateFromH2, rejectH2IfContentLengthTooBig, writeH2Response } from './http2-helpers.ts'
import { createByteLimit } from '../body/limit.ts'

/** TLS options accepted by the h2 (secure) adapter. */
export interface Http2AdapterOptions {
  /** TLS certificate (PEM). */
  cert: Buffer | string
  /** TLS private key (PEM). */
  key: Buffer | string
  /**
   * If true, the secure server also accepts HTTP/1.1 connections via ALPN
   * fallback. Inbound HTTP/1 requests are dispatched through the same path
   * used by `NodeAdapter`. Default: false (HTTP/2 only).
   */
  allowHttp1?: boolean
}

/**
 * HTTP/2-over-TLS (`h2`) transport. Uses Node's built-in `http2.createSecureServer`.
 * Browsers REQUIRE TLS for HTTP/2 — there is no cleartext HTTP/2 negotiation
 * over the open web. For local testing without certs, use {@link Http2cAdapter}.
 *
 * Per-request: on `'stream'`, populates a pooled `IngeniumContext` from pseudo-headers,
 * awaits dispatch, then writes the response via `stream.respond()` + `stream.end()`
 * (or pipes for `Readable` bodies).
 */
export class Http2Adapter implements Transport {
  private hooks: TransportHooks | null = null

  constructor(private readonly options: Http2AdapterOptions) {}

  attach(hooks: TransportHooks): void {
    this.hooks = hooks
  }

  async listen(port: number, host = '127.0.0.1'): Promise<ListeningServer> {
    if (!this.hooks) throw new Error('Http2Adapter.listen() called before attach()')
    const hooks = this.hooks

    const server: Http2SecureServer = createH2Server({
      cert: this.options.cert,
      key: this.options.key,
      allowHTTP1: this.options.allowHttp1 === true,
    })

    server.on('stream', (stream, headers) => {
      handleStream(stream, headers, hooks).catch((err) => emergencyAbort(stream, err))
    })

    if (this.options.allowHttp1 === true) {
      // ALPN fallback: HTTP/1.1 clients land here, NOT on `'stream'`.
      server.on('request', (req, res) => {
        handleHttp1Fallback(req, res, hooks).catch((err) => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }))
          } else {
            res.end()
          }
          process.emitWarning(`ingenium(h2/http1): dispatch leaked: ${(err as Error).message ?? String(err)}`)
        })
      })
    }

    return startServer(server, port, host)
  }
}

/**
 * HTTP/2 cleartext (`h2c`) transport. Uses Node's `http2.createServer` — no TLS,
 * so this is intended for local development, internal service-to-service calls
 * behind an L7 proxy that handles TLS termination, or test suites. Browsers do
 * not speak h2c; use {@link Http2Adapter} for browser traffic.
 *
 * Constructor takes no required arguments.
 */
export class Http2cAdapter implements Transport {
  private hooks: TransportHooks | null = null

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  constructor(_options: {} = {}) {
    // Reserved for future tuning knobs (settings frame, max concurrent streams, …).
  }

  attach(hooks: TransportHooks): void {
    this.hooks = hooks
  }

  async listen(port: number, host = '127.0.0.1'): Promise<ListeningServer> {
    if (!this.hooks) throw new Error('Http2cAdapter.listen() called before attach()')
    const hooks = this.hooks

    const server: Http2Server = createH2cServer()

    server.on('stream', (stream, headers) => {
      handleStream(stream, headers, hooks).catch((err) => emergencyAbort(stream, err))
    })

    return startServer(server, port, host)
  }
}

// ───── shared internals ─────────────────────────────────────────────────────

async function handleStream(
  stream: ServerHttp2Stream,
  headers: Http2IncomingHeaders,
  hooks: TransportHooks,
): Promise<void> {
  // Normalize the optional hook field — older fixtures may not set it.
  const maxBytes = hooks.maxRequestBytes ?? Number.POSITIVE_INFINITY
  // Reject oversized Content-Length BEFORE we acquire a context — the request
  // is dead on arrival. Chunked / unknown-length bodies fall through to the
  // byte-limit Transform installed by `populateFromH2`.
  if (rejectH2IfContentLengthTooBig(stream, headers, maxBytes)) return

  const ctx = hooks.acquire()
  try {
    populateFromH2(ctx, stream, headers, maxBytes)
    await hooks.dispatch(ctx)
    writeH2Response(ctx, stream)
  } finally {
    hooks.release(ctx)
  }
}

/**
 * HTTP/1.1 fallback path used when `allowHttp1` is set on `Http2Adapter`.
 * Mirrors `NodeAdapter.populateContext` + `writeResponse`. We can't reuse
 * `node.ts` directly because the framework should not import from a sibling
 * adapter, and `Http2ServerRequest`/`Response` are subclasses of the http
 * primitives but with the same surface — so we duplicate the small populate +
 * write loop here.
 */
async function handleHttp1Fallback(
  req: Http2ServerRequest,
  res: Http2ServerResponse,
  hooks: TransportHooks,
): Promise<void> {
  // Same Content-Length pre-check as the pure-h1 NodeAdapter path.
  const maxBytes = hooks.maxRequestBytes ?? Number.POSITIVE_INFINITY
  if (Number.isFinite(maxBytes)) {
    const raw = req.headers['content-length']
    if (typeof raw === 'string' && raw.length > 0) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > maxBytes) {
        res.statusCode = 413
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('connection', 'close')
        res.end(
          JSON.stringify({
            error: `Request body exceeded ${maxBytes} bytes`,
            code: 'PAYLOAD_TOO_LARGE',
          }),
        )
        return
      }
    }
  }

  const ctx = hooks.acquire()
  try {
    ctx.method = (req.method ?? 'GET') as HttpMethod
    const url = req.url ?? '/'
    ctx.url = url
    const qIdx = url.indexOf('?')
    if (qIdx >= 0) {
      ctx.path = url.slice(0, qIdx)
      ctx.rawQuery = url.slice(qIdx + 1)
    } else {
      ctx.path = url
      ctx.rawQuery = ''
    }
    ctx.headers = req.headers as unknown as IncomingHttpHeaders

    const cl = req.headers['content-length']
    const contentLength = typeof cl === 'string' ? Number(cl) : undefined
    const ct = typeof req.headers['content-type'] === 'string' ? (req.headers['content-type'] as string) : undefined
    const source = Number.isFinite(maxBytes) ? req.pipe(createByteLimit(maxBytes)) : req
    ctx.body._attach(source, ct, Number.isFinite(contentLength) ? contentLength : undefined)

    await hooks.dispatch(ctx)

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
  } finally {
    hooks.release(ctx)
  }
}

function emergencyAbort(stream: ServerHttp2Stream, err: unknown): void {
  // Last-resort safety net — the dispatch loop should have caught everything.
  if (!stream.headersSent && !stream.destroyed) {
    try {
      stream.respond(
        { [h2.HTTP2_HEADER_STATUS]: 500, 'content-type': 'application/json; charset=utf-8' },
      )
      stream.end(JSON.stringify({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }))
    } catch {
      // fall through to destroy
    }
  }
  if (!stream.destroyed) {
    try {
      stream.close(h2.NGHTTP2_INTERNAL_ERROR)
    } catch {
      stream.destroy()
    }
  }
  process.emitWarning(`ingenium(h2): dispatch leaked: ${(err as Error).message ?? String(err)}`)
}

/**
 * Bind the underlying server and return a {@link ListeningServer} handle.
 * Same socket-tracking pattern as `NodeAdapter` so `close({ gracefulTimeoutMs })`
 * can force-kill idle connections.
 */
function startServer(
  server: Http2Server | Http2SecureServer,
  port: number,
  host: string,
): Promise<ListeningServer> {
  const sockets = new Set<Socket | TLSSocket>()
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('secureConnection', (socket: TLSSocket) => {
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
        close: (opts?: CloseOptions): Promise<void> =>
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
                for (const socket of sockets) socket.destroy()
              }, Math.max(0, timeoutMs))
              if (typeof timer.unref === 'function') timer.unref()
            }
          }),
      })
    })
  })
}

// Re-export types for downstream consumers who need to type adapter options.
export type { Http2AdapterOptions as Http2Options }
