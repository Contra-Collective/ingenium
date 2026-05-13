import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import type { RiftexContext } from '../context/context.ts'

/**
 * Reflect a handler's return value to the response per the contract:
 *
 * | return type            | wire output                       |
 * |------------------------|-----------------------------------|
 * | `undefined` / `null`   | 204 (unless ctx wrote)            |
 * | string starting w/ `<` | 200 text/html                     |
 * | other string           | 200 text/plain                    |
 * | `Buffer` / `Uint8Array`| 200 application/octet-stream      |
 * | `Readable`             | 200 streamed                      |
 * | any object/array       | 200 application/json              |
 *
 * If a `ctx.json/text/html/stream/redirect/send` helper has already been
 * called, the return value is ignored.
 */
export function reflectReturn(ctx: RiftexContext, value: unknown): void {
  if (ctx._written) return

  if (value === undefined || value === null) {
    ctx.status(204)
    return
  }

  if (typeof value === 'string') {
    if (value.length > 0 && value.charCodeAt(0) === 60 /* '<' */) {
      ctx.html(value)
    } else {
      ctx.text(value)
    }
    return
  }

  if (Buffer.isBuffer(value)) {
    ctx.send(value)
    return
  }

  if (value instanceof Uint8Array) {
    ctx.send(Buffer.from(value))
    return
  }

  if (value instanceof Readable) {
    ctx.stream(value)
    return
  }

  // Default: JSON-serialize anything else (objects, arrays, numbers, booleans).
  ctx.json(value)
}
