import type { ServerHttp2Stream, IncomingHttpHeaders as Http2IncomingHeaders } from 'node:http2'
import { constants as h2 } from 'node:http2'
import type { IncomingHttpHeaders } from 'node:http'
import type { RexContext } from '../context/context.ts'
import type { HttpMethod } from '../router/types.ts'

/**
 * HTTP/2 pseudo-headers (RFC 7540 §8.1.2.1). These appear as keys on the
 * `headers` object when reading an inbound stream and must NOT be passed to
 * any setHeader-style API on outbound responses (Node throws). Strip them
 * from `ctx.headers` so user middleware sees a Node-http-compatible shape.
 */
const PSEUDO_HEADERS = new Set<string>([':method', ':path', ':scheme', ':authority', ':status'])

/**
 * Some HTTP/1 hop-by-hop headers are forbidden in HTTP/2 (RFC 7540 §8.1.2.2).
 * Strip these from outbound responses if a handler set them — `Transfer-Encoding`
 * is the most common offender (Express habit) and `connection` is implicit.
 */
const FORBIDDEN_RESPONSE_HEADERS = new Set<string>([
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-connection',
  'upgrade',
])

/**
 * Populate a pooled `RexContext` from an inbound HTTP/2 stream + headers map.
 * Mirrors `node.ts`'s `populateContext` but unpacks pseudo-headers and
 * uppercases the method (HTTP/2 sends it lowercase per node:http2 convention).
 */
export function populateFromH2(
  ctx: RexContext,
  stream: ServerHttp2Stream,
  headers: Http2IncomingHeaders,
): void {
  const rawMethod = headers[h2.HTTP2_HEADER_METHOD]
  ctx.method = (typeof rawMethod === 'string' ? rawMethod.toUpperCase() : 'GET') as HttpMethod

  const rawPath = headers[h2.HTTP2_HEADER_PATH]
  const url = typeof rawPath === 'string' ? rawPath : '/'
  ctx.url = url

  // Split path / query without allocating a URL object — same trick as NodeAdapter.
  const qIdx = url.indexOf('?')
  if (qIdx >= 0) {
    ctx.path = url.slice(0, qIdx)
    ctx.rawQuery = url.slice(qIdx + 1)
  } else {
    ctx.path = url
    ctx.rawQuery = ''
  }

  // Filter pseudo-headers out of the user-visible `ctx.headers` so middleware
  // sees an `IncomingHttpHeaders`-compatible bag.
  const userHeaders: Record<string, string | string[] | undefined> = Object.create(null)
  for (const name in headers) {
    if (PSEUDO_HEADERS.has(name)) continue
    userHeaders[name] = headers[name]
  }
  ctx.headers = userHeaders as IncomingHttpHeaders

  const cl = userHeaders['content-length']
  const contentLength = typeof cl === 'string' ? Number(cl) : undefined
  const ct = typeof userHeaders['content-type'] === 'string' ? (userHeaders['content-type'] as string) : undefined

  // The `ServerHttp2Stream` IS a Duplex with a Readable side — `RexBody` only
  // reads from it (via the byte-limit Transform), which works identically.
  ctx.body._attach(stream, ct, Number.isFinite(contentLength) ? contentLength : undefined)
}

/**
 * Write the `RexContext` response state to an HTTP/2 stream. Handles all four
 * `_body.kind` variants. HTTP/2 has no `Transfer-Encoding: chunked` (framing
 * is implicit) and no hop-by-hop headers, so we strip those before responding.
 */
export function writeH2Response(ctx: RexContext, stream: ServerHttp2Stream): void {
  if (stream.destroyed || stream.closed) return

  const responseHeaders: Record<string, string | string[] | number> = Object.create(null)
  responseHeaders[h2.HTTP2_HEADER_STATUS] = ctx._statusCode

  for (const name in ctx._headers) {
    const lc = name.toLowerCase()
    if (FORBIDDEN_RESPONSE_HEADERS.has(lc)) continue
    if (PSEUDO_HEADERS.has(lc)) continue // defensive — shouldn't ever happen
    const value = ctx._headers[name]
    if (value !== undefined) responseHeaders[lc] = value
  }

  const body = ctx._body
  switch (body.kind) {
    case 'none':
      stream.respond(responseHeaders, { endStream: true })
      return
    case 'string': {
      if (responseHeaders['content-length'] === undefined) {
        responseHeaders['content-length'] = Buffer.byteLength(body.data)
      }
      stream.respond(responseHeaders)
      stream.end(body.data)
      return
    }
    case 'buffer': {
      if (responseHeaders['content-length'] === undefined) {
        responseHeaders['content-length'] = body.data.length
      }
      stream.respond(responseHeaders)
      stream.end(body.data)
      return
    }
    case 'stream': {
      stream.respond(responseHeaders)
      body.data.pipe(stream)
      return
    }
  }
}
