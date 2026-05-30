import { Writable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import type { IngeniumContext } from 'ingenium'

/**
 * A real `stream.Writable` (hence a real `EventEmitter`) presenting an
 * Express/`ServerResponse`-style response surface over a `IngeniumContext`.
 *
 * Why a real Writable (vs the old plain-object shim): the middleware that the
 * old shim couldn't support all need genuine stream/emitter behavior —
 *
 *   - `compression` reassigns `res.write`/`res.end` to interpose a gzip
 *     stream, then calls the originals. On a plain object the patched
 *     functions were never invoked (the old shim even trapped the assignment
 *     and threw). Here the originals are real `Writable` methods, so the
 *     gzipped bytes flow through `_write` into the buffer.
 *   - `express-session` defers `Set-Cookie` to header-commit time via
 *     `on-headers` (which patches `res.writeHead`) and saves on `res.end`.
 *   - `morgan` logs its end-of-request tokens from `res.on('finish')`.
 *
 * Headers + status are proxied LIVE to the context (so header-only middleware
 * like `cors`/`helmet` that never end the response still land their headers,
 * and `removeHeader` works). Only the response BODY is buffered, and only when
 * the middleware actually writes one — flushed into `ctx._body` on `_final`,
 * just before `'finish'` fires.
 */
export class IngeniumResShim extends Writable {
  headersSent = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any = undefined
  // A real EventEmitter socket: `on-finished`/`on-headers` (used by morgan,
  // express-session, compression) attach 'error'/'close' listeners to it.
  socket: EventEmitter & { writable: boolean; remoteAddress: string }

  constructor(ctx: IngeniumContext) {
    // decodeStrings:true (default) means `_write` always receives Buffers.
    super()
    RES_CTX.set(this, ctx)
    this.socket = Object.assign(new EventEmitter(), {
      writable: true,
      remoteAddress: ctx.remoteAddress,
    })
  }

  // ───── Status (proxied live to the context) ────────────────────────────

  get statusCode(): number {
    return RES_CTX.get(this)!._statusCode
  }
  set statusCode(code: number) {
    RES_CTX.get(this)!._statusCode = code
  }

  /** Express-style chainable status setter. */
  status(code: number): this {
    RES_CTX.get(this)!._statusCode = code
    return this
  }

  sendStatus(code: number): this {
    RES_CTX.get(this)!._statusCode = code
    return this.end(String(code)) as unknown as this
  }

  // ───── Headers (proxied live to the context) ───────────────────────────

  setHeader(name: string, value: string | string[] | number): this {
    const headers = RES_CTX.get(this)!._headers
    headers[name.toLowerCase()] = Array.isArray(value)
      ? value
      : typeof value === 'number'
        ? String(value)
        : value
    return this
  }

  /** Express alias for `setHeader`, with object form. */
  set(name: string | Record<string, string | string[] | number>, value?: string | string[] | number): this {
    if (typeof name === 'object') {
      for (const k of Object.keys(name)) {
        const v = name[k]
        if (v !== undefined) this.setHeader(k, v)
      }
      return this
    }
    return this.setHeader(name, value as string | string[] | number)
  }

  header(name: string, value: string | string[] | number): this {
    return this.setHeader(name, value)
  }

  getHeader(name: string): string | string[] | undefined {
    return RES_CTX.get(this)!._headers[name.toLowerCase()]
  }

  /** Express alias for `getHeader`. */
  get(name: string): string | string[] | undefined {
    return this.getHeader(name)
  }

  getHeaderNames(): string[] {
    return Object.keys(RES_CTX.get(this)!._headers)
  }

  getHeaders(): Record<string, string | string[]> {
    return { ...RES_CTX.get(this)!._headers }
  }

  hasHeader(name: string): boolean {
    return name.toLowerCase() in RES_CTX.get(this)!._headers
  }

  removeHeader(name: string): void {
    delete RES_CTX.get(this)!._headers[name.toLowerCase()]
  }

  /** Append a value to a (possibly repeated) header, e.g. `Vary`, `Set-Cookie`. */
  append(name: string, value: string | string[]): this {
    const existing = this.getHeader(name)
    if (existing === undefined) return this.setHeader(name, value)
    const merged = (Array.isArray(existing) ? existing : [existing]).concat(value)
    return this.setHeader(name, merged)
  }

  vary(field: string): this {
    return this.append('vary', field)
  }

  type(contentType: string): this {
    return this.setHeader('content-type', contentType)
  }

  /**
   * Express-style header commit point. `on-headers` reassigns this method to
   * run header-mutating listeners (e.g. `express-session`'s Set-Cookie) the
   * first time it's called — so it MUST stay a normal, reassignable method.
   * Our own `_final` calls it once if the middleware never did.
   */
  writeHead(
    code: number,
    reasonOrHeaders?: string | Record<string, string | string[] | number>,
    headers?: Record<string, string | string[] | number>,
  ): this {
    const ctx = RES_CTX.get(this)!
    ctx._statusCode = code
    const hdrs = typeof reasonOrHeaders === 'object' ? reasonOrHeaders : headers
    if (hdrs) {
      for (const k of Object.keys(hdrs)) {
        const v = hdrs[k]
        if (v !== undefined) this.setHeader(k, v)
      }
    }
    this.headersSent = true
    return this
  }

  /**
   * `http.ServerResponse` internal that several middleware call to force a
   * header commit (e.g. `express-session`'s patched `end`). Real Node defines
   * it; our shim maps it onto `writeHead`.
   */
  _implicitHeader(): void {
    if (!this.headersSent) this.writeHead(this.statusCode)
  }

  // ───── Body writers ────────────────────────────────────────────────────
  //
  // `write`/`end` are inherited from Writable (real, reassignable — this is
  // what lets `compression` wrap them). The Express conveniences below just
  // set a default content-type and delegate to the (possibly patched) `end`.

  json(body: unknown): this {
    if (!this.hasHeader('content-type')) {
      this.setHeader('content-type', 'application/json; charset=utf-8')
    }
    return this.end(JSON.stringify(body)) as unknown as this
  }

  send(body?: unknown): this {
    if (body === undefined || body === null) {
      return this.end() as unknown as this
    }
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      return this.end(Buffer.isBuffer(body) ? body : Buffer.from(body)) as unknown as this
    }
    if (typeof body === 'string') {
      if (!this.hasHeader('content-type')) {
        this.setHeader('content-type', 'text/html; charset=utf-8')
      }
      return this.end(body) as unknown as this
    }
    return this.json(body)
  }

  redirect(statusOrUrl: number | string, url?: string): this {
    let status = 302
    let location: string
    if (typeof statusOrUrl === 'number') {
      status = statusOrUrl
      location = url ?? ''
    } else {
      location = statusOrUrl
    }
    const ctx = RES_CTX.get(this)!
    ctx._statusCode = status
    this.setHeader('location', location)
    return this.end() as unknown as this
  }

  // ───── Buffering → context flush ───────────────────────────────────────

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    chunksFor(this).push(chunk)
    cb()
  }

  override _final(cb: (err?: Error | null) => void): void {
    // Commit headers if nobody did — this runs any `on-headers` listeners
    // (e.g. express-session's Set-Cookie, compression's Content-Encoding
    // decision) before we read `ctx._headers` to ship.
    if (!this.headersSent) this.writeHead(this.statusCode)

    const ctx = RES_CTX.get(this)!
    const chunks = chunksFor(this)
    if (chunks.length === 0) {
      ctx._body = { kind: 'none' }
    } else {
      ctx._body = { kind: 'buffer', data: Buffer.concat(chunks) }
    }
    ctx._written = true
    cb()
  }

  /** Legacy `res.finished` flag some middleware still read. */
  get finished(): boolean {
    return this.writableEnded
  }
}

// Free-form surface: middleware adds props (`res.flush`, `res.locals`, …) and
// reads arbitrary keys. Declaration-merged so callers stay typed without an
// in-class index signature (which esbuild rejects).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IngeniumResShim { [key: string]: any }

const RES_CTX = new WeakMap<IngeniumResShim, IngeniumContext>()
const RES_CHUNKS = new WeakMap<IngeniumResShim, Buffer[]>()

function chunksFor(res: IngeniumResShim): Buffer[] {
  let chunks = RES_CHUNKS.get(res)
  if (!chunks) {
    chunks = []
    RES_CHUNKS.set(res, chunks)
  }
  return chunks
}

export function createResShim(ctx: IngeniumContext): IngeniumResShim {
  return new IngeniumResShim(ctx)
}
