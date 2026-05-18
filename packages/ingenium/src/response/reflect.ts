import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import type { IngeniumContext } from '../context/context.ts'

/**
 * Dev-mode gate. Captured ONCE at module load; in production V8 dead-code-
 * eliminates the branch bodies behind `if (IS_DEV)`. Every dev diagnostic
 * MUST check this first so it pays nothing on the hot path.
 */
const IS_DEV = process.env.NODE_ENV !== 'production'

/**
 * @internal Once-per-process flag for the fetch-style `Response` warning.
 * Exposed via `_resetReflectFootgunWarnings()` for tests.
 */
let _responseObjectWarned = false

/** @internal Test-only — clear the once-flag for the fetch-Response warning. */
export function _resetReflectFootgunWarnings(): void {
  _responseObjectWarned = false
}

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
export function reflectReturn(ctx: IngeniumContext, value: unknown): void {
  if (ctx._written) return

  if (value === undefined || value === null) {
    ctx.status(204)
    return
  }

  // Dev-only — catch the common mistake of returning a fetch-style `Response`
  // object (e.g. `return new Response('hi')`). Ingenium handlers return plain
  // values; interop with the Fetch Response shape is intentionally not
  // supported. Warn once, then fall through to the 204 path so the framework
  // doesn't accidentally JSON-serialize the Response object's enumerable bag.
  if (IS_DEV && typeof Response !== 'undefined' && value instanceof Response) {
    if (!_responseObjectWarned) {
      _responseObjectWarned = true
      try {
        process.emitWarning(
          'Handler returned a fetch-style Response object. Ingenium handlers return plain values or call ctx.json/text/etc. The Response was ignored.',
          { type: 'IngeniumResponseObjectWarning' },
        )
      } catch {
        // process.emitWarning can throw in unusual runtimes (workers); swallow.
      }
    }
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
