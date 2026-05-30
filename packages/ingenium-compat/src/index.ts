import { Writable } from 'node:stream'
import { Buffer } from 'node:buffer'
import type { IngeniumContext, IngeniumMiddleware } from 'ingenium'
import { createReqShim, syncReqStateBack, IngeniumReqShim } from './req-shim.ts'
import { createResShim, IngeniumResShim } from './res-shim.ts'

/**
 * Express-style middleware signature. We use loose `any` here on purpose:
 * Express's own type for `req`/`res` is `Request`/`Response`, but the shim
 * objects we pass do not implement the full surface. `any` lets cors/helmet/
 * morgan/compression/body-parser/etc. accept our shims at the call site
 * without `as never` gymnastics in user code.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExpressMiddleware = (req: any, res: any, next: (err?: unknown) => void) => void

/**
 * Options for `expressCompat`. Reserved for future use; currently empty.
 */
export interface ExpressCompatOptions {
  /**
   * @deprecated No longer used. The shims are now real Node streams, so the
   * middleware that used to be "known broken" (body-parser, multer,
   * compression, express-session, …) work through `expressCompat`. This flag
   * is accepted but ignored, kept only so older call sites keep compiling.
   */
  allowKnownBroken?: boolean
}

// The unpatched Writable methods. If a wrapped middleware reassigns either on
// the instance (the compression / express-session pattern), it is a
// response-transformer and the downstream response must be replayed THROUGH
// `res` so its patched write/end runs.
const PRISTINE_WRITE = Writable.prototype.write
const PRISTINE_END = Writable.prototype.end

/**
 * Wrap an Express-style `(req, res, next)` middleware so it can run inside a
 * Ingenium middleware chain.
 *
 * The `req`/`res` passed to the middleware are real Node streams
 * (`IngeniumReqShim extends Readable`, `IngeniumResShim extends Writable`)
 * wired to the `IngeniumContext`, so body-reading middleware (`body-parser`,
 * `multer`) and response-patching middleware (`compression`,
 * `express-session`, `morgan`) all behave as they do under Express.
 *
 * Control flow:
 *  - Middleware writes the response itself (`res.json/send/end`, no `next`):
 *    the chain is short-circuited; nothing downstream runs.
 *  - Middleware calls `next()`: the Ingenium downstream chain runs. If the
 *    middleware patched `res.write`/`res.end` (a response transformer), the
 *    downstream response is replayed through `res` so the patch takes effect;
 *    otherwise the downstream response is left untouched (fast path) and we
 *    just emit `'finish'` for observers like `morgan`.
 *  - Middleware calls `next(err)` / throws / streams error: the wrapper
 *    rejects so the error reaches the global onError boundary.
 */
export function expressCompat(
  middleware: ExpressMiddleware,
  _options: ExpressCompatOptions = {},
): IngeniumMiddleware {
  return async (ctx: IngeniumContext, next: () => Promise<void>): Promise<void> => {
    const req: IngeniumReqShim = createReqShim(ctx)
    const res: IngeniumResShim = createResShim(ctx)
    // Cross-link like Express does (some middleware read res.req / req.res).
    res.req = req
    req.res = res

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const ok = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      const fail = (err: unknown): void => {
        if (settled) return
        settled = true
        reject(err)
      }

      // Resolve once the response is fully written — either by the middleware
      // itself or by the downstream replay below. Fires after `_final`.
      res.once('finish', ok)
      res.once('error', fail)
      req.once('error', fail)

      const onNext = (err?: unknown): void => {
        if (err !== undefined && err !== null) {
          fail(err)
          return
        }
        // Mirror req.* mutations (req.body from body-parser, req.session, …)
        // into ctx.state BEFORE the downstream chain reads them.
        syncReqStateBack(req, ctx)

        const isTransformer = res.write !== PRISTINE_WRITE || res.end !== PRISTINE_END

        next()
          .then(() => {
            if (isTransformer && !res.writableEnded) {
              // Replay the context response through `res` so the middleware's
              // patched write/end (gzip, session save-on-end, …) runs.
              replayResponseThroughRes(ctx, res)
              // 'finish' (registered above) resolves once `_final` lands.
            } else {
              // Fast path: downstream already wrote ctx directly. Signal a
              // synthetic 'finish' so observers (morgan/on-finished) fire,
              // without round-tripping the body through `res`.
              res.headersSent = true
              res.emit('finish')
              ok()
            }
          })
          .catch(fail)
      }

      try {
        middleware(req, res, onNext)
      } catch (err) {
        fail(err)
      }
    })
  }
}

/**
 * Drive the context's already-produced response back through the Express
 * `res` so a response-transforming middleware can act on it. `res.writeHead`
 * is invoked first so `on-headers` listeners (e.g. express-session's
 * Set-Cookie, compression's Content-Encoding negotiation) fire before any
 * bytes flow; then the body is written via the (patched) `res.write`/`res.end`.
 */
function replayResponseThroughRes(ctx: IngeniumContext, res: IngeniumResShim): void {
  if (!res.headersSent) res.writeHead(ctx._statusCode)
  const body = ctx._body
  switch (body.kind) {
    case 'none':
      res.end()
      break
    case 'string':
      res.end(Buffer.from(body.data))
      break
    case 'buffer':
      res.end(body.data)
      break
    case 'stream':
      body.data.pipe(res)
      break
  }
}

export { createReqShim, IngeniumReqShim, syncReqStateBack } from './req-shim.ts'
export { createResShim, IngeniumResShim } from './res-shim.ts'
