import type { IncomingHttpHeaders } from 'node:http'
import type { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { RiftexBody } from './body.ts'
import type { HttpMethod } from '../router/types.ts'
import { resolveForwarded, type ForwardedInfo, type TrustProxy } from '../proxy/trust.ts'

/** Sentinel for routes with no params — frozen, so `ctx.params.foo` is safe. */
const EMPTY_PARAMS = Object.freeze(Object.create(null) as Record<string, string>)

/** Internal response body shape — adapter writes one of these to the wire. */
export type ResponseBody =
  | { kind: 'none' }
  | { kind: 'buffer'; data: Buffer }
  | { kind: 'string'; data: string }
  | { kind: 'stream'; data: Readable }

/**
 * Per-request context. Pool-bound: one instance per pool slot, reused
 * across thousands of requests. All mutable fields are reset between uses.
 *
 * The `Params` generic is a phantom — it narrows `ctx.params` for typed
 * route handlers but is `Record<string, string>` at runtime.
 */
export class RiftexContext<Params = Record<string, string>> {
  // ───── Request ─────────────────────────────────────────────────────────
  /** HTTP method, uppercase. */
  method: HttpMethod = 'GET'
  /** Full request URL including query string (e.g. `/users/42?expand=posts`). */
  url = '/'
  /** Path portion of the URL (no query string). Set by the adapter. */
  path = '/'
  /** Raw query string (no leading `?`). Use `query` for parsed access. */
  rawQuery = ''
  /** Route params, written at trie-match time. */
  params: Params = EMPTY_PARAMS as unknown as Params
  /** Lowercased request headers (Node convention). */
  headers: IncomingHttpHeaders = {}
  /** Lazy body accessor. */
  readonly body: RiftexBody = new RiftexBody()
  /** Free-form per-request state for plugins/middleware (e.g. `ctx.user = ...`). */
  state: Record<string, unknown> = Object.create(null) as Record<string, unknown>

  /** Lazy-parsed query. First access caches the URLSearchParams. */
  private _query: URLSearchParams | null = null
  get query(): URLSearchParams {
    if (!this._query) this._query = new URLSearchParams(this.rawQuery)
    return this._query
  }

  // ───── Network info (trust-proxy aware) ────────────────────────────────
  /** Immediate socket peer address — populated by the adapter. */
  remoteAddress = '127.0.0.1'
  /** Underlying transport protocol — populated by the adapter (http for node:http, https for TLS). */
  baseProtocol: 'http' | 'https' = 'http'
  /** @internal `trustProxy` config carried in from the app. */ _trustProxy: TrustProxy = false
  /** @internal Cached forwarded resolution; computed lazily from headers. */
  private _forwarded: ForwardedInfo | null = null

  private resolveForwarded(): ForwardedInfo {
    if (!this._forwarded) {
      this._forwarded = resolveForwarded(
        this._trustProxy,
        this.remoteAddress,
        this.headers as Record<string, string | string[] | undefined>,
        this.baseProtocol,
      )
    }
    return this._forwarded
  }

  /**
   * Best-effort client IP. With `trustProxy: false` this is the immediate
   * socket peer; with trust-proxy enabled the X-Forwarded-For chain is
   * walked according to the configured trust policy.
   */
  get ip(): string { return this.resolveForwarded().ip }
  /** Full forwarded chain (left-to-right, immediate peer last). */
  get ips(): readonly string[] { return this.resolveForwarded().ips }
  /** Best-effort protocol — honors `X-Forwarded-Proto` when trust-proxy is enabled. */
  get protocol(): 'http' | 'https' { return this.resolveForwarded().protocol }
  /** Convenience: `protocol === 'https'`. */
  get secure(): boolean { return this.protocol === 'https' }
  /** Best-effort hostname (no port) — honors `X-Forwarded-Host` when trust-proxy is enabled. */
  get hostname(): string { return this.resolveForwarded().hostname }

  // ───── Response ────────────────────────────────────────────────────────
  /** @internal */ _statusCode = 200
  /** @internal */ _headers: Record<string, string | string[]> = Object.create(null) as Record<string, string | string[]>
  /** @internal */ _body: ResponseBody = { kind: 'none' }
  /** @internal Whether a response helper has been called. */
  _written = false

  // ───── Response helpers ────────────────────────────────────────────────

  /** Set the HTTP status code. Returns `this` for chaining. */
  status(code: number): this {
    this._statusCode = code
    return this
  }

  /** Set a response header (case-insensitive). Returns `this` for chaining. */
  set(name: string, value: string | string[]): this {
    this._headers[name.toLowerCase()] = value
    return this
  }
  /** Alias for `set` — matches Express's `res.setHeader`. */
  setHeader(name: string, value: string | string[]): this {
    return this.set(name, value)
  }

  /** Get a previously-set response header (lowercase lookup). */
  getHeader(name: string): string | string[] | undefined {
    return this._headers[name.toLowerCase()]
  }

  /** Send a JSON response. */
  json(body: unknown, status?: number): void {
    if (status !== undefined) this._statusCode = status
    if (!this._headers['content-type']) this._headers['content-type'] = 'application/json; charset=utf-8'
    this._body = { kind: 'string', data: JSON.stringify(body) }
    this._written = true
  }

  /** Send a `text/plain` response. */
  text(body: string, status?: number): void {
    if (status !== undefined) this._statusCode = status
    if (!this._headers['content-type']) this._headers['content-type'] = 'text/plain; charset=utf-8'
    this._body = { kind: 'string', data: body }
    this._written = true
  }

  /** Send a `text/html` response. */
  html(body: string, status?: number): void {
    if (status !== undefined) this._statusCode = status
    if (!this._headers['content-type']) this._headers['content-type'] = 'text/html; charset=utf-8'
    this._body = { kind: 'string', data: body }
    this._written = true
  }

  /** Send a redirect (default 302). */
  redirect(location: string, status = 302): void {
    this._statusCode = status
    this._headers.location = location
    this._body = { kind: 'none' }
    this._written = true
  }

  /** Stream a `Readable` to the client. Sets content-type if not already set. */
  stream(readable: Readable, contentType?: string): void {
    if (contentType && !this._headers['content-type']) this._headers['content-type'] = contentType
    this._body = { kind: 'stream', data: readable }
    this._written = true
  }

  /** Send a `Buffer` body verbatim. */
  send(body: Buffer | string, status?: number): void {
    if (status !== undefined) this._statusCode = status
    if (typeof body === 'string') {
      if (!this._headers['content-type']) this._headers['content-type'] = 'text/plain; charset=utf-8'
      this._body = { kind: 'string', data: body }
    } else {
      if (!this._headers['content-type']) this._headers['content-type'] = 'application/octet-stream'
      this._body = { kind: 'buffer', data: body }
    }
    this._written = true
  }

  // ───── Pool lifecycle ──────────────────────────────────────────────────

  /**
   * Reset all per-request state. Called by the pool before returning the
   * context to the free list. Reassignments preserve the V8 hidden class
   * so subsequent allocations stay monomorphic.
   */
  reset(): void {
    this.method = 'GET'
    this.url = '/'
    this.path = '/'
    this.rawQuery = ''
    this.params = EMPTY_PARAMS as unknown as Params
    this.headers = {}
    this._query = null
    this.state = Object.create(null) as Record<string, unknown>
    this.remoteAddress = '127.0.0.1'
    this.baseProtocol = 'http'
    this._trustProxy = false
    this._forwarded = null
    this._statusCode = 200
    this._headers = Object.create(null) as Record<string, string | string[]>
    this._body = { kind: 'none' }
    this._written = false
    this.body._reset()
  }
}
