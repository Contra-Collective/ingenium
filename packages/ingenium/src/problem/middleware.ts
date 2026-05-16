import type { IngeniumMiddleware } from '../middleware/types.ts'
import { toProblemDetails } from './serialize.ts'
import type {
  ProblemDetailsOptions,
  ResolvedProblemDetailsOptions,
} from './types.ts'

const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8'

/**
 * RFC 7807 Problem Details middleware. Wraps downstream handlers in a
 * try/catch and serializes any `IngeniumError` (or unknown error) as
 * `application/problem+json` instead of the framework's default
 * `{ error, code, fields? }` shape.
 *
 * Composition notes:
 * - This sits as a regular middleware in front of user handlers, NOT in
 *   place of `app.onError`. If `app.onError` is configured AND it re-throws
 *   (or the user handler throws past the onError), this middleware catches
 *   the error before it reaches the default boundary.
 * - Composes cleanly with other middleware (e.g. idempotency) — the
 *   try/catch is the only thing it does on the way out.
 *
 * @example
 *   app.use(ingenium.problemDetails({
 *     typeBaseUrl: 'https://api.example.com/errors/',
 *     includeStack: process.env.NODE_ENV !== 'production',
 *   }))
 */
export function problemDetailsMiddleware(opts: ProblemDetailsOptions = {}): IngeniumMiddleware {
  const resolved: ResolvedProblemDetailsOptions = {
    typeBaseUrl: opts.typeBaseUrl ?? 'about:blank',
    includeStack: opts.includeStack ?? false,
    instance: opts.instance ?? ((ctx) => ctx.path),
  }

  return async (ctx, next) => {
    try {
      await next()
    } catch (err) {
      // If something downstream already wrote a response (e.g. handler
      // partially wrote then threw), don't clobber it.
      if (ctx._written) throw err

      const problem = toProblemDetails(err, resolved, ctx)

      // Force the problem+json content-type even if a handler pre-set
      // application/json on the context.
      ctx.set('content-type', PROBLEM_CONTENT_TYPE)
      ctx._statusCode = problem.status
      ctx._body = { kind: 'string', data: JSON.stringify(problem) }
      ctx._written = true
    }
  }
}
