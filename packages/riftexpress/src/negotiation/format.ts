/**
 * `formatResponse(ctx, handlers)` — Express's `res.format` for RiftExpress.
 *
 * Picks the best handler key against the request `Accept` header, runs it,
 * sets `Content-Type` to the matched key, and writes the result as the
 * response body. If no handler matches and no `default` key is provided,
 * throws a `RiftexError(406, 'NOT_ACCEPTABLE')`.
 *
 * Handlers may be sync or async — `formatResponse` always awaits.
 */

import { Buffer } from 'node:buffer'
import { selectBest } from './accept.ts'
import type { NegotiableCtx } from './negotiate.ts'
import { RiftexError } from '../errors.ts'

/** Minimal context shape required by `formatResponse` — narrower than full `RiftexContext`. */
export interface FormattableCtx extends NegotiableCtx {
  set(name: string, value: string | string[]): unknown
  json(body: unknown, status?: number): void
  send(body: Buffer | string, status?: number): void
}

/** Map of `mime → handler`. The reserved key `default` is the no-match fallback. */
export type FormatHandlers = Record<string, () => unknown | Promise<unknown>>

/**
 * Pick the best handler key for `Accept` and run it.
 *
 * - JSON-shaped result objects are written via `ctx.json`.
 * - String / Buffer results are written via `ctx.send` with the matched
 *   content-type preserved (instead of `send`'s default text/plain inference).
 * - `default` handler is used when no explicit key matches.
 * - No match + no default → throws `RiftexError(406, 'NOT_ACCEPTABLE')`.
 */
export async function formatResponse(
  ctx: FormattableCtx,
  handlers: FormatHandlers,
): Promise<void> {
  const keys = Object.keys(handlers).filter((k) => k !== 'default')
  const acceptHeader = (() => {
    const v = ctx.headers['accept']
    return Array.isArray(v) ? v.join(',') : v
  })()

  let chosenKey: string | false = selectBest(acceptHeader, keys)

  // No explicit match — fall back to `default`, else 406.
  if (chosenKey === false) {
    if ('default' in handlers) {
      const result = await handlers['default']!()
      writeResult(ctx, result, undefined)
      return
    }
    throw new RiftexError(
      406,
      'NOT_ACCEPTABLE',
      `None of the offered types [${keys.join(', ')}] satisfy Accept: ${acceptHeader ?? '*/*'}`,
    )
  }

  const handler = handlers[chosenKey]
  if (!handler) {
    // Defensive — shouldn't happen since selectBest only returns offered keys.
    throw new RiftexError(406, 'NOT_ACCEPTABLE', 'Internal: matched handler missing')
  }
  const result = await handler()
  writeResult(ctx, result, chosenKey)
}

function writeResult(ctx: FormattableCtx, result: unknown, contentType: string | undefined): void {
  if (contentType) ctx.set('content-type', contentType)
  if (result === undefined || result === null) {
    // Treat as empty body — caller handles 204 elsewhere.
    ctx.send('', undefined)
    return
  }
  if (typeof result === 'string') {
    ctx.send(result, undefined)
    return
  }
  if (Buffer.isBuffer(result) || result instanceof Uint8Array) {
    ctx.send(Buffer.isBuffer(result) ? result : Buffer.from(result))
    return
  }
  // Object → JSON.
  ctx.json(result)
}
