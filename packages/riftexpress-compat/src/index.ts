import type { RiftexContext, RiftexMiddleware } from 'riftexpress'
import { createReqShim, syncReqStateBack, type RiftexReqShim } from './req-shim.ts'
import { createResShim, type RiftexResShim } from './res-shim.ts'

/**
 * Express-style middleware signature. We use loose `any` here on purpose:
 * Express's own type for `req`/`res` is `Request`/`Response`, but the shim
 * objects we pass do not implement the full surface. `any` lets cors/helmet/
 * morgan/compression accept our shims at the call site without `as never`
 * gymnastics in user code.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExpressMiddleware = (req: any, res: any, next: (err?: unknown) => void) => void

/**
 * Wrap an Express-style `(req, res, next)` middleware so it can run inside
 * a RiftExpress middleware chain.
 *
 * Behavior:
 *  - If the middleware writes the response (`res.json/send/end/writeHead`),
 *    the RiftExpress chain is short-circuited (we do NOT call `next()`).
 *  - If the middleware calls `next()` without writing, the Riftex chain continues.
 *  - If the middleware calls `next(err)`, the wrapper rejects with that error
 *    so it flows to the global onError boundary.
 */
export function expressCompat(middleware: ExpressMiddleware): RiftexMiddleware {
  return async (ctx: RiftexContext, next: () => Promise<void>): Promise<void> => {
    const req: RiftexReqShim = createReqShim(ctx)
    const res: RiftexResShim = createResShim(ctx)

    let nextCalled = false
    let nextErr: unknown = undefined

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finishOk = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const finishErr = (e: unknown): void => {
        if (settled) return
        settled = true
        reject(e)
      }

      try {
        middleware(req, res, (err?: unknown) => {
          nextCalled = true
          if (err !== undefined && err !== null) {
            nextErr = err
            finishErr(err)
            return
          }
          finishOk()
        })
      } catch (e) {
        finishErr(e)
        return
      }

      // If the middleware wrote the response synchronously without calling
      // next, resolve immediately so we don't hang.
      if (res._ended || ctx._written) {
        finishOk()
      }
    })

    // Mirror any req.* mutations (e.g. req.user set by an auth middleware)
    // back to ctx.state for downstream Riftex middleware.
    syncReqStateBack(req, ctx)

    if (nextErr !== undefined && nextErr !== null) {
      throw nextErr
    }

    // If the middleware terminated the response, do not advance the chain.
    if (res._ended || ctx._written) {
      return
    }

    if (nextCalled) {
      await next()
    }
    // If middleware never called next() and never wrote — treat as halt.
  }
}

export { createReqShim } from './req-shim.ts'
export { createResShim } from './res-shim.ts'
