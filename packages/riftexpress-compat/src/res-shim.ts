import { Buffer } from 'node:buffer'
import type { RiftexContext } from 'riftexpress'

/**
 * Minimal ServerResponse-like surface used by cors / helmet / morgan /
 * compression. Mutates the underlying RiftexContext's response state directly
 * so that whether the middleware writes the response or just sets headers,
 * the changes land where the framework expects them.
 */
export interface RiftexResShim {
  headersSent: boolean
  finished: boolean
  statusCode: number
  status(code: number): RiftexResShim
  setHeader(name: string, value: string | string[] | number): RiftexResShim
  getHeader(name: string): string | string[] | undefined
  removeHeader(name: string): void
  writeHead(code: number, headers?: Record<string, string | string[] | number>): RiftexResShim
  json(body: unknown): RiftexResShim
  send(body: unknown): RiftexResShim
  end(chunk?: string | Buffer, encoding?: BufferEncoding): RiftexResShim
  /** @internal — true once a terminal write happened. */
  _ended: boolean
}

export function createResShim(ctx: RiftexContext): RiftexResShim {
  // `any` allowed inside this shim: Express's ServerResponse signatures are
  // wildly polymorphic and we only model the subset the target middlewares hit.
  const res: RiftexResShim = {
    headersSent: false,
    finished: false,

    get statusCode(): number {
      return ctx._statusCode
    },
    set statusCode(code: number) {
      ctx._statusCode = code
    },

    status(code: number): RiftexResShim {
      ctx._statusCode = code
      return res
    },

    setHeader(name: string, value: string | string[] | number): RiftexResShim {
      ctx._headers[name.toLowerCase()] = typeof value === 'number' ? String(value) : value
      return res
    },

    getHeader(name: string): string | string[] | undefined {
      return ctx._headers[name.toLowerCase()]
    },

    removeHeader(name: string): void {
      delete ctx._headers[name.toLowerCase()]
    },

    writeHead(code: number, headers?: Record<string, string | string[] | number>): RiftexResShim {
      ctx._statusCode = code
      if (headers) {
        for (const k of Object.keys(headers)) {
          const v = headers[k]
          if (v === undefined) continue
          ctx._headers[k.toLowerCase()] = typeof v === 'number' ? String(v) : v
        }
      }
      res.headersSent = true
      return res
    },

    json(body: unknown): RiftexResShim {
      ctx.json(body)
      res.headersSent = true
      res.finished = true
      res._ended = true
      return res
    },

    send(body: unknown): RiftexResShim {
      if (body === undefined || body === null) {
        ctx._body = { kind: 'none' }
        ctx._written = true
      } else if (Buffer.isBuffer(body)) {
        ctx.send(body)
      } else if (typeof body === 'string') {
        ctx.text(body)
      } else if (body instanceof Uint8Array) {
        ctx.send(Buffer.from(body))
      } else {
        ctx.json(body)
      }
      res.headersSent = true
      res.finished = true
      res._ended = true
      return res
    },

    end(chunk?: string | Buffer, _encoding?: BufferEncoding): RiftexResShim {
      if (chunk !== undefined) {
        if (typeof chunk === 'string') {
          ctx._body = { kind: 'string', data: chunk }
        } else {
          ctx._body = { kind: 'buffer', data: chunk }
        }
        ctx._written = true
      } else if (!ctx._written) {
        // No body, but mark written so the chain stops.
        ctx._body = { kind: 'none' }
        ctx._written = true
      }
      res.headersSent = true
      res.finished = true
      res._ended = true
      return res
    },

    _ended: false,
  }

  // ───── Loud failure for monkey-patch attempts (write / pipe / end) ─────
  //
  // `compression` and `express-session` work by REASSIGNING res.write or
  // res.end to a wrapped function — `res.write = (chunk) => { gzip... }`.
  // On a real http.ServerResponse the wrap is invisible and works; on this
  // plain-object shim the patch lands but is never invoked, so the response
  // ships unmodified and the user gets a silent failure.
  //
  // We trap the WRITE side of those properties only — reads return existing
  // values (so feature-detection like `typeof res.write === 'function'` still
  // returns undefined cleanly, matching current behavior). Doing it on assign
  // means cors/helmet/morgan are completely unaffected — they never assign to
  // these. Cost on the hot path is zero: this only runs at shim-creation
  // time, and only fires when a broken middleware tries to patch.
  for (const member of ['write', 'pipe'] as const) {
    Object.defineProperty(res, member, {
      configurable: true,
      enumerable: false,
      get(): undefined { return undefined },
      set(): void {
        throw new TypeError(
          `expressCompat(): the wrapped middleware tried to monkey-patch ` +
          `\`res.${member}\`. The response shim is a plain object, not a real ` +
          `http.ServerResponse, so the patched function would never be invoked ` +
          `and the response would ship unmodified. This is how \`compression\` ` +
          `and a few session libraries fail silently. ` +
          `Use a RiftExpress-native equivalent (or terminate gzip at the proxy). ` +
          `See packages/riftexpress-compat/COMPATIBILITY.md.`,
        )
      },
    })
  }
  // `end` already exists as a method on the shim; trap reassignment without
  // breaking the existing call site.
  const originalEnd = res.end
  Object.defineProperty(res, 'end', {
    configurable: true,
    enumerable: true,
    get(): typeof originalEnd { return originalEnd },
    set(): void {
      throw new TypeError(
        `expressCompat(): the wrapped middleware tried to monkey-patch \`res.end\`. ` +
        `The shim's end() flushes the response synchronously to the RiftexContext; ` +
        `a replacement function would never see those bytes. ` +
        `See packages/riftexpress-compat/COMPATIBILITY.md.`,
      )
    },
  })

  return res
}
