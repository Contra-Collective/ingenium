import type { IncomingHttpHeaders } from 'node:http'
import type {
  ListeningServer,
  RexContext,
  Transport,
  TransportHooks,
} from 'riftexpress'
import type { HttpMethod } from 'riftexpress'
import { nodeReadableToWebStream, webStreamToNodeReadable } from './web-streams.ts'

/**
 * Loose Bun global declaration. We avoid a hard `import type { Serve } from
 * 'bun'` so this file still type-checks under a vanilla Node toolchain
 * without `@types/bun` installed. When `@types/bun` is present, its global
 * `Bun` augmentation supersedes this declaration.
 */
declare const Bun:
  | {
      serve(opts: {
        port?: number
        hostname?: string
        fetch: (req: Request) => Promise<Response> | Response
      }): {
        port: number
        hostname: string
        stop(closeActiveConnections?: boolean): Promise<void> | void
      }
    }
  | undefined

/**
 * `Bun.serve()` transport. Mirrors the contract of `NodeAdapter`: on each
 * request, populate a pooled `RexContext` from the WinterCG `Request`,
 * await dispatch, then build a `Response` from the context's response state.
 */
export class BunAdapter implements Transport {
  private hooks: TransportHooks | null = null

  attach(hooks: TransportHooks): void {
    this.hooks = hooks
  }

  async listen(port: number, host = '127.0.0.1'): Promise<ListeningServer> {
    if (!this.hooks) throw new Error('BunAdapter.listen() called before attach()')
    if (typeof Bun === 'undefined') {
      throw new Error('BunAdapter requires the Bun runtime — run with `bun` instead of `node`.')
    }
    const hooks = this.hooks

    const server = Bun.serve({
      port,
      hostname: host,
      fetch: (req: Request) => handleRequest(req, hooks),
    })

    return {
      port: server.port,
      host: server.hostname,
      close: async () => {
        await server.stop(true)
      },
    }
  }
}

async function handleRequest(req: Request, hooks: TransportHooks): Promise<Response> {
  const ctx = hooks.acquire()
  try {
    populateContext(ctx, req)
    await hooks.dispatch(ctx)
    return buildResponse(ctx)
  } finally {
    hooks.release(ctx)
  }
}

function populateContext(ctx: RexContext, req: Request): void {
  ctx.method = req.method.toUpperCase() as HttpMethod

  // Parse path + raw query straight from the URL string — avoid building a
  // full `URL` object when we only need two slices. `req.url` is absolute.
  const fullUrl = req.url
  const schemeEnd = fullUrl.indexOf('://')
  const pathStart = schemeEnd >= 0 ? fullUrl.indexOf('/', schemeEnd + 3) : 0
  const urlNoOrigin = pathStart >= 0 ? fullUrl.slice(pathStart) : '/'
  ctx.url = urlNoOrigin
  const qIdx = urlNoOrigin.indexOf('?')
  if (qIdx >= 0) {
    ctx.path = urlNoOrigin.slice(0, qIdx)
    ctx.rawQuery = urlNoOrigin.slice(qIdx + 1)
  } else {
    ctx.path = urlNoOrigin
    ctx.rawQuery = ''
  }

  // Materialize WinterCG headers into Node's lowercased-key shape.
  const headers: IncomingHttpHeaders = {}
  for (const [k, v] of req.headers.entries()) {
    headers[k.toLowerCase()] = v
  }
  ctx.headers = headers

  // Bridge the body LAZILY: wrap the WinterCG ReadableStream in a Node
  // Readable, but do not read from it until something downstream pulls.
  const cl = headers['content-length']
  const contentLength = cl ? Number(cl) : undefined
  const ct = headers['content-type']
  const source = req.body ? webStreamToNodeReadable(req.body) : null
  ctx.body._attach(source, ct, Number.isFinite(contentLength) ? contentLength : undefined)
}

function buildResponse(ctx: RexContext): Response {
  const headers = new Headers()
  for (const name in ctx._headers) {
    const value = ctx._headers[name]
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v)
    } else {
      headers.set(name, value)
    }
  }

  const body = ctx._body
  const status = ctx._statusCode

  // 204/304 must not carry a body — let `Response` handle that itself by
  // passing `null`, otherwise WinterCG runtimes throw.
  switch (body.kind) {
    case 'none':
      return new Response(null, { status, headers })
    case 'string':
      return new Response(body.data, { status, headers })
    case 'buffer': {
      // `Buffer` is a `Uint8Array` subclass; copy view into a fresh
      // `Uint8Array` so the response sees a plain typed array.
      const view = new Uint8Array(body.data.buffer, body.data.byteOffset, body.data.byteLength)
      return new Response(view, { status, headers })
    }
    case 'stream': {
      const webStream = nodeReadableToWebStream(body.data)
      return new Response(webStream, { status, headers })
    }
  }
}
