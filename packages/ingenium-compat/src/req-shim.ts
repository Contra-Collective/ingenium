import type { IngeniumContext } from 'ingenium'

/**
 * Minimal IncomingMessage-like object built over a IngeniumContext.
 *
 * We expose `ctx.state` keys directly on the shim so Express middleware can
 * read/write `req.user`, `req.session`, etc. The wrapper in `index.ts` mirrors
 * any new props back into `ctx.state` after the middleware completes.
 */
export interface IngeniumReqShim {
  method: string
  url: string
  originalUrl: string
  path: string
  // Express middleware reads `req.query` as a parsed object, not URLSearchParams.
  query: Record<string, string | string[]>
  headers: Record<string, string | string[] | undefined>
  httpVersion: string
  socket: { remoteAddress: string }
  // Free-form: state spread + middleware mutations live here.
  [key: string]: unknown
}

function parseQuery(rawQuery: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null) as Record<string, string | string[]>
  if (!rawQuery) return out
  const params = new URLSearchParams(rawQuery)
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    out[key] = all.length > 1 ? all : (all[0] ?? '')
  }
  return out
}

export function createReqShim(ctx: IngeniumContext): IngeniumReqShim {
  const req: IngeniumReqShim = {
    method: ctx.method,
    url: ctx.url,
    originalUrl: ctx.url,
    path: ctx.path,
    query: parseQuery(ctx.rawQuery),
    // ctx.headers is already lowercased per Node convention.
    headers: { ...ctx.headers } as Record<string, string | string[] | undefined>,
    httpVersion: '1.1',
    socket: { remoteAddress: '127.0.0.1' },
  }

  // Spread ctx.state onto req so existing Express middleware sees req.user etc.
  for (const k of Object.keys(ctx.state)) {
    req[k] = ctx.state[k]
  }

  return req
}

/**
 * Mirror any non-known fields the middleware added/changed on `req` back into
 * `ctx.state` so subsequent Ingenium middleware sees them.
 */
const REQ_RESERVED = new Set([
  'method',
  'url',
  'originalUrl',
  'path',
  'query',
  'headers',
  'httpVersion',
  'socket',
])

export function syncReqStateBack(req: IngeniumReqShim, ctx: IngeniumContext): void {
  for (const k of Object.keys(req)) {
    if (REQ_RESERVED.has(k)) continue
    ctx.state[k] = req[k]
  }
}
