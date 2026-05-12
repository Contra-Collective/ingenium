import { Buffer } from 'node:buffer'
import type { RexContext } from 'riftexpress'

/**
 * Minimal ServerResponse-like surface used by cors / helmet / morgan /
 * compression. Mutates the underlying RexContext's response state directly
 * so that whether the middleware writes the response or just sets headers,
 * the changes land where the framework expects them.
 */
export interface RexResShim {
  headersSent: boolean
  finished: boolean
  statusCode: number
  status(code: number): RexResShim
  setHeader(name: string, value: string | string[] | number): RexResShim
  getHeader(name: string): string | string[] | undefined
  removeHeader(name: string): void
  writeHead(code: number, headers?: Record<string, string | string[] | number>): RexResShim
  json(body: unknown): RexResShim
  send(body: unknown): RexResShim
  end(chunk?: string | Buffer, encoding?: BufferEncoding): RexResShim
  /** @internal — true once a terminal write happened. */
  _ended: boolean
}

export function createResShim(ctx: RexContext): RexResShim {
  // `any` allowed inside this shim: Express's ServerResponse signatures are
  // wildly polymorphic and we only model the subset the target middlewares hit.
  const res: RexResShim = {
    headersSent: false,
    finished: false,

    get statusCode(): number {
      return ctx._statusCode
    },
    set statusCode(code: number) {
      ctx._statusCode = code
    },

    status(code: number): RexResShim {
      ctx._statusCode = code
      return res
    },

    setHeader(name: string, value: string | string[] | number): RexResShim {
      ctx._headers[name.toLowerCase()] = typeof value === 'number' ? String(value) : value
      return res
    },

    getHeader(name: string): string | string[] | undefined {
      return ctx._headers[name.toLowerCase()]
    },

    removeHeader(name: string): void {
      delete ctx._headers[name.toLowerCase()]
    },

    writeHead(code: number, headers?: Record<string, string | string[] | number>): RexResShim {
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

    json(body: unknown): RexResShim {
      ctx.json(body)
      res.headersSent = true
      res.finished = true
      res._ended = true
      return res
    },

    send(body: unknown): RexResShim {
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

    end(chunk?: string | Buffer, _encoding?: BufferEncoding): RexResShim {
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
