import type { IngeniumMiddleware } from '../middleware/types.ts'

/**
 * Express compatibility shim. In Ingenium, body parsing is lazy via
 * `ctx.body.json()` / `ctx.body.urlencoded()` / `ctx.body.text()` — there is
 * no parse-on-every-request middleware to register. This factory exists so
 * existing `app.use(express.json())` migration patterns keep compiling and
 * reading naturally; the returned middleware is a zero-cost no-op.
 *
 * If you need to enforce a default `maxBytes` across all body access, set it
 * via the `limit` option here and read it inside your handlers when calling
 * `ctx.body.json({ limit })` — Ingenium doesn't store it implicitly.
 *
 * @returns a no-op middleware
 */
export function jsonMiddleware(_opts?: { limit?: number }): IngeniumMiddleware {
  return async (_ctx, next) => {
    await next()
  }
}

/**
 * See `jsonMiddleware` — same rationale. URL-encoded parsing is lazy via
 * `ctx.body.urlencoded()`.
 */
export function urlencodedMiddleware(_opts?: { limit?: number }): IngeniumMiddleware {
  return async (_ctx, next) => {
    await next()
  }
}
