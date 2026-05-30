import { Readable } from 'node:stream'
import type { IncomingHttpHeaders } from 'node:http'
import type { IngeniumContext } from 'ingenium'

/**
 * A real `stream.Readable` that presents an Express/`IncomingMessage`-style
 * request surface over a `IngeniumContext`.
 *
 * Why a real Readable (vs the old plain-object shim): Express middleware that
 * reads the body — `body-parser` (`req.on('data')`/`req.on('end')`), `multer`
 * (`req.pipe(busboy)`) — needs an actual event-emitting, pipeable stream.
 * A plain object throws `req.on is not a function` / `req.pipe is not a
 * function`. By extending `Readable` we get the full surface for free.
 *
 * Lazy body (the performance contract): we do NOT touch the underlying request
 * stream until the middleware actually reads it. Header-only middleware
 * (`cors`, `helmet`) never trigger `_read`, so they pay nothing beyond the
 * object allocation — the body source is left untouched for `ctx.body.*` or a
 * downstream handler. The source is only claimed (and `ctx.body` marked
 * consumed) on the first `_read()`.
 *
 * State mirroring: `ctx.state` keys are spread onto the shim so existing
 * middleware sees `req.user`, `req.session`, etc. Anything the middleware then
 * adds or mutates is mirrored back to `ctx.state` by `syncReqStateBack` (see
 * below) so downstream Ingenium middleware can read it.
 */
export class IngeniumReqShim extends Readable {
  method: string
  url: string
  originalUrl: string
  baseUrl = ''
  path: string
  // Express middleware reads `req.query` as a parsed object, not URLSearchParams.
  query: Record<string, string | string[]>
  headers: IncomingHttpHeaders
  rawHeaders: string[]
  httpVersion = '1.1'
  httpVersionMajor = 1
  httpVersionMinor = 1
  complete = false
  socket: { remoteAddress: string; encrypted: boolean }
  // Trust-proxy-aware fields, lifted from ctx so `express-rate-limit` and
  // friends can read `req.ip` directly (no custom keyGenerator needed).
  ip: string
  ips: string[]
  protocol: string
  secure: boolean
  hostname: string

  constructor(ctx: IngeniumContext) {
    super()
    this.method = ctx.method
    this.url = ctx.url
    this.originalUrl = ctx.url
    this.path = ctx.path
    this.query = parseQuery(ctx.rawQuery)
    // ctx.headers is already lowercased per Node convention.
    this.headers = { ...ctx.headers } as IncomingHttpHeaders
    this.rawHeaders = buildRawHeaders(ctx.headers)
    this.socket = { remoteAddress: ctx.remoteAddress, encrypted: ctx.baseProtocol === 'https' }
    // Minimal Express `app` accessor: some middleware (express-rate-limit's
    // trust-proxy validation) probe `req.app.get('trust proxy')`. There is no
    // Express app, so every setting reads as undefined.
    this.app = { get: () => undefined }
    this.ip = ctx.ip
    this.ips = [...ctx.ips]
    this.protocol = ctx.protocol
    this.secure = ctx.secure
    this.hostname = ctx.hostname

    // Snapshot the structural surface BEFORE spreading ctx.state. Everything
    // present now (these fields + the Readable's own internals) is scaffolding
    // we must NOT mirror back; everything added later (state keys, middleware
    // output like req.body/req.cookies/req._passport) IS mirrored back.
    const baseline = new Set(Object.keys(this))

    for (const k of Object.keys(ctx.state)) {
      this[k] = ctx.state[k]
    }

    REQ_INTERNAL.set(this, { ctx, src: null, wired: false, baseline })
  }

  override _read(): void {
    const internal = REQ_INTERNAL.get(this)
    if (!internal) {
      this.push(null)
      return
    }

    if (!internal.wired) {
      internal.wired = true
      // `ctx.body._source` is the raw IncomingMessage (or a byte-limit
      // Transform wrapping it). Claim it exactly once; mark the body consumed
      // so a stray `ctx.body.json()` can't double-read the same stream.
      const body = internal.ctx.body as unknown as {
        _source: Readable | null
        _consumed: boolean
      }
      const src = body._consumed ? null : body._source
      if (!src) {
        this.complete = true
        this.push(null)
        return
      }
      body._consumed = true
      internal.src = src
      src.on('data', (chunk: Buffer) => {
        // Honor backpressure: if the consumer's buffer is full, pause the
        // source and resume on the next `_read`.
        if (!this.push(chunk)) src.pause()
      })
      src.on('end', () => {
        this.complete = true
        this.push(null)
      })
      src.on('error', (err: Error) => this.destroy(err))
      return
    }

    if (internal.src && internal.src.isPaused()) internal.src.resume()
  }
}

// Free-form surface: state spread + middleware mutations (`req.user`,
// `req.body`, `req.cookies`, …) live here. Declaration-merged so callers stay
// typed without an in-class index signature (which esbuild rejects).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IngeniumReqShim { [key: string]: any }

interface ReqInternal {
  ctx: IngeniumContext
  src: Readable | null
  wired: boolean
  baseline: Set<string>
}

// Internal state held off-instance so it never shows up in `Object.keys(req)`
// (which would pollute the state mirror-back below).
const REQ_INTERNAL = new WeakMap<IngeniumReqShim, ReqInternal>()

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

/** Build a flat `[name, value, name, value, …]` rawHeaders array (Node shape). */
function buildRawHeaders(headers: IncomingHttpHeaders): string[] {
  const raw: string[] = []
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) {
      for (const item of v) raw.push(k, item)
    } else if (v !== undefined) {
      raw.push(k, v)
    }
  }
  return raw
}

export function createReqShim(ctx: IngeniumContext): IngeniumReqShim {
  return new IngeniumReqShim(ctx)
}

/**
 * Mirror any fields the middleware added/changed on `req` back into
 * `ctx.state` so subsequent Ingenium middleware sees them. Skips the
 * structural request surface and the Readable's own internals (captured in the
 * per-shim `baseline` at construction time); state-derived keys and
 * middleware output (e.g. `req.body`, `req.cookies`, `req._passport`) flow
 * through.
 */
export function syncReqStateBack(req: IngeniumReqShim, ctx: IngeniumContext): void {
  const internal = REQ_INTERNAL.get(req)
  const baseline = internal?.baseline
  for (const k of Object.keys(req)) {
    if (baseline && baseline.has(k)) continue
    ctx.state[k] = req[k]
  }
}
