import type { IngeniumContext, IngeniumMiddleware } from 'ingenium'
import { createReqShim, syncReqStateBack, type IngeniumReqShim } from './req-shim.ts'
import { createResShim, type IngeniumResShim } from './res-shim.ts'
import { detectKnownBroken, formatBrokenMessage } from './known-broken.ts'

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
 * Options for `expressCompat`.
 */
export interface ExpressCompatOptions {
  /**
   * Bypass the detect-and-throw guard for known-broken middleware
   * (`body-parser`, `multer`, `express-session`, `compression`).
   *
   * When `true`, `expressCompat` emits a `process.emitWarning(...)` instead
   * of throwing, and returns the wrapping middleware as usual. The
   * underlying compatibility problem is unchanged — sessions still won't
   * persist, body-parser still hangs, etc. Use only if you have a very
   * specific reason and have read COMPATIBILITY.md.
   *
   * @default false
   */
  allowKnownBroken?: boolean
}

/**
 * Wrap an Express-style `(req, res, next)` middleware so it can run inside
 * a Ingenium middleware chain.
 *
 * Behavior:
 *  - If the middleware writes the response (`res.json/send/end/writeHead`),
 *    the Ingenium chain is short-circuited (we do NOT call `next()`).
 *  - If the middleware calls `next()` without writing, the Ingenium chain continues.
 *  - If the middleware calls `next(err)`, the wrapper rejects with that error
 *    so it flows to the global onError boundary.
 *
 * If `middleware` is one of a known-broken set (see `known-broken.ts` and
 * `COMPATIBILITY.md`), this throws a `TypeError` at registration so users
 * get a loud, actionable error pointing at the Ingenium-native
 * equivalent. Pass `{ allowKnownBroken: true }` to downgrade to a warning.
 */
export function expressCompat(
  middleware: ExpressMiddleware,
  options: ExpressCompatOptions = {},
): IngeniumMiddleware {
  const detected = detectKnownBroken(middleware)
  if (detected) {
    const message = formatBrokenMessage(detected)
    if (options.allowKnownBroken) {
      process.emitWarning(message, 'IngeniumCompatKnownBroken')
    } else {
      throw new TypeError(message)
    }
  }

  return async (ctx: IngeniumContext, next: () => Promise<void>): Promise<void> => {
    const req: IngeniumReqShim = createReqShim(ctx)
    const res: IngeniumResShim = createResShim(ctx)

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
    // back to ctx.state for downstream Ingenium middleware.
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
export { detectKnownBroken, KNOWN_BROKEN, formatBrokenMessage } from './known-broken.ts'
export type { KnownBrokenEntry, DetectedBroken } from './known-broken.ts'
