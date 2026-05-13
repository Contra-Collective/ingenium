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

  return res
}
