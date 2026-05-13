import type { RiftexContext } from '../context/context.ts'
import { reflectReturn } from '../response/reflect.ts'
import type { ComposedHandler, RiftexMiddleware } from './types.ts'

const NOOP: ComposedHandler = async () => {}

/**
 * Compose an array of middleware into a single async function. Composition
 * runs ONCE at registration / first-request time; the returned function has
 * no per-request `bind`, no index variable, and no `stack[n]` lookups.
 *
 * The dispatcher chain is pre-built bottom-up: `dispatchers[i]` runs
 * `stack[i]` with a `next` that invokes `dispatchers[i + 1]`. Each
 * middleware-level invocation still allocates one closure to capture `ctx`
 * (unavoidable without dropping concurrency safety).
 *
 * Double-`next()` calls are detected only when `process.env.REX_DEBUG` is
 * truthy, to keep the production hot path free of per-call guard variables.
 */
export function compose(stack: readonly RiftexMiddleware[]): ComposedHandler {
  const len = stack.length
  if (len === 0) return NOOP

  const debug = !!process.env.REX_DEBUG

  // dispatchers[i] runs middleware[i] and threads control through middleware[i+1..]
  // dispatchers[len] is the terminal noop.
  const dispatchers: ComposedHandler[] = new Array(len + 1)
  dispatchers[len] = NOOP

  for (let i = len - 1; i >= 0; i--) {
    const fn = stack[i]!
    const nextDispatcher = dispatchers[i + 1]!
    if (debug) {
      dispatchers[i] = async (ctx) => {
        let called = false
        await fn(ctx, () => {
          if (called) {
            throw new Error(`next() called multiple times in middleware at index ${i}`)
          }
          called = true
          return nextDispatcher(ctx)
        })
      }
    } else {
      dispatchers[i] = async (ctx) => {
        await fn(ctx, () => nextDispatcher(ctx))
      }
    }
  }

  return dispatchers[0] ?? NOOP
}

/**
 * Compose middleware then append a terminal handler that does not receive a
 * `next` (so a route handler can be the leaf of the chain). The handler's
 * return value is reflected to the response per the contract in
 * `response/reflect.ts` — unless the handler called a `ctx.json/...` helper,
 * in which case the return value is ignored.
 *
 * Hot-path optimization: when there are no middleware, we skip the
 * dispatcher chain entirely and return a thin wrapper that calls the
 * handler directly. We also detect synchronous handler return values
 * (non-thenable) and avoid the `await` microtask in that case — measurable
 * on JSON-returning routes that don't touch the body.
 */
export function composeWithHandler(
  middleware: readonly RiftexMiddleware[],
  handler: (ctx: RiftexContext) => unknown | Promise<unknown>,
): ComposedHandler {
  if (middleware.length === 0) {
    return makeFastTerminal(handler)
  }
  const terminal: RiftexMiddleware = async (ctx) => {
    const result = await handler(ctx)
    reflectReturn(ctx, result)
  }
  return compose([...middleware, terminal])
}

/** No-middleware fast path: skip compose, skip await when handler is sync. */
function makeFastTerminal(
  handler: (ctx: RiftexContext) => unknown | Promise<unknown>,
): ComposedHandler {
  return async (ctx) => {
    const r = handler(ctx)
    if (r !== null && typeof r === 'object' && typeof (r as Promise<unknown>).then === 'function') {
      reflectReturn(ctx, await r)
    } else {
      reflectReturn(ctx, r)
    }
  }
}
