import type { RiftexContext } from '../context/context.ts'

/**
 * A function that runs as part of the middleware chain. Call `next()` to
 * continue to the next middleware; omit it to short-circuit.
 *
 * @example
 * const logger: RiftexMiddleware = async (ctx, next) => {
 *   const start = Date.now()
 *   await next()
 *   ctx.logger?.info(`${ctx.method} ${ctx.path} ${Date.now() - start}ms`)
 * }
 */
export type RiftexMiddleware = (ctx: RiftexContext, next: () => Promise<void>) => unknown | Promise<unknown>

/**
 * A composed middleware chain plus terminal handler. Returned by `compose()`.
 * Internally cached on each trie leaf.
 */
export type ComposedHandler = (ctx: RiftexContext) => Promise<void>

/**
 * A user-facing route handler. Its return value is reflected to the wire by
 * the response-helper dispatcher (see `response/helpers.ts`):
 *
 * - `undefined` → 204 (unless `ctx.json/...` was already called)
 * - `string`    → 200 text/plain (or text/html if it starts with `<`)
 * - object      → 200 application/json
 * - `Buffer`/`Uint8Array` → 200 application/octet-stream
 * - `Readable`  → streamed response
 *
 * For full control, call `ctx.json/text/html/stream/redirect` and return
 * `void` (or any value — return value is ignored once a helper has run).
 */
export type RiftexHandler<Params = Record<string, string>> = (
  ctx: RiftexContext<Params>,
) => unknown | Promise<unknown>
