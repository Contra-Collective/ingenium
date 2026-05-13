import { Buffer } from 'node:buffer'
import type { RiftexContext, ResponseBody } from '../context/context.ts'
import type { RiftexMiddleware } from '../middleware/types.ts'
import type { HttpMethod } from '../router/types.ts'
import { IdempotencyMemoryStore } from './store.ts'
import type {
  CachedResponse,
  IdempotencyOptions,
  ResolvedIdempotencyOptions,
} from './types.ts'

const DEFAULT_METHODS: readonly HttpMethod[] = ['POST', 'PATCH', 'DELETE']

/** Authorization-header-derived scope; falls back to `'anon'`. */
function defaultScope(ctx: RiftexContext): string {
  const auth = ctx.headers['authorization']
  if (typeof auth === 'string' && auth.length > 0) return auth
  if (Array.isArray(auth) && auth.length > 0 && typeof auth[0] === 'string') return auth[0]
  return 'anon'
}

/** Pull a header value as a single string (first element if it came as an array). */
function readHeader(ctx: RiftexContext, lowerName: string): string | undefined {
  const v = ctx.headers[lowerName]
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined
  return undefined
}

/**
 * Snapshot whatever the handler wrote to `ctx`. Streams are NOT cached —
 * we cannot rewind a `Readable`, so a streamed response makes the request
 * non-idempotent (the second call will run the handler again).
 *
 * Returns `null` to signal "do not cache" (stream / nothing written).
 */
function snapshot(ctx: RiftexContext): CachedResponse | null {
  if (!ctx._written) return null
  const body = ctx._body
  let serialized: string | Buffer | null
  switch (body.kind) {
    case 'none':
      serialized = null
      break
    case 'string':
      serialized = body.data
      break
    case 'buffer':
      // Copy the buffer — caller may reuse the underlying memory.
      serialized = Buffer.from(body.data)
      break
    case 'stream':
      return null
  }
  // Shallow-copy headers; values are strings or string[] (immutable in practice).
  const headersCopy: Record<string, string | string[]> = Object.create(null)
  for (const k of Object.keys(ctx._headers)) {
    const v = ctx._headers[k]
    if (v === undefined) continue
    headersCopy[k] = Array.isArray(v) ? [...v] : v
  }
  return { statusCode: ctx._statusCode, headers: headersCopy, body: serialized }
}

/** Replay a cached response onto a fresh `ctx`. */
function replay(ctx: RiftexContext, cached: CachedResponse): void {
  ctx._statusCode = cached.statusCode
  // Replace, not merge — replayed response is authoritative.
  ctx._headers = Object.create(null) as Record<string, string | string[]>
  for (const k of Object.keys(cached.headers)) {
    const v = cached.headers[k]
    if (v === undefined) continue
    ctx._headers[k] = Array.isArray(v) ? [...v] : v
  }
  ctx._headers['idempotent-replayed'] = 'true'
  let nextBody: ResponseBody
  if (cached.body === null) {
    nextBody = { kind: 'none' }
  } else if (typeof cached.body === 'string') {
    nextBody = { kind: 'string', data: cached.body }
  } else {
    nextBody = { kind: 'buffer', data: Buffer.from(cached.body) }
  }
  ctx._body = nextBody
  ctx._written = true
}

/**
 * Idempotency-Key middleware (per Stripe / IETF idempotency-key draft).
 *
 * Behavior:
 * - Non-mutating method or missing header → pass through.
 * - Mutating method WITH header:
 *   1. Build cache key: `<scope>:<method>:<path>:<idempotency-key>`.
 *   2. Cache hit → replay the cached (status, headers, body) and set
 *      `Idempotent-Replayed: true`. Handler does NOT run.
 *   3. Cache miss → run handler. If the response is cacheable (i.e. not a
 *      stream and something was written), persist it under the key with
 *      the configured TTL.
 *   4. Concurrent in-flight requests for the same key are coordinated via
 *      an in-process Promise map: the second request awaits the first and
 *      replays its result.
 *
 * Note: the cache key intentionally does NOT include the request body —
 * the spec assumes the client guarantees byte-for-byte identical retries,
 * and reading the body at middleware-entry time would defeat lazy parsing.
 *
 * @example
 *   app.use(riftex.idempotency({
 *     store: new IdempotencyMemoryStore(),
 *     ttlSeconds: 86_400,
 *   }))
 */
export function idempotencyMiddleware(opts: IdempotencyOptions = {}): RiftexMiddleware {
  const resolved: ResolvedIdempotencyOptions = {
    header: (opts.header ?? 'Idempotency-Key').toLowerCase(),
    store: opts.store ?? new IdempotencyMemoryStore(),
    ttlMs: (opts.ttlSeconds ?? 86_400) * 1000,
    scope: opts.scope ?? defaultScope,
    methodSet: new Set(opts.methods ?? DEFAULT_METHODS),
  }

  if (resolved.ttlMs <= 0) {
    throw new Error('idempotency: ttlSeconds must be > 0')
  }

  // Per-key in-flight map. The promise resolves once the first handler
  // finishes and its response has been snapshotted (or with `null` if the
  // response wasn't cacheable — second request then runs the handler).
  const inflight: Map<string, Promise<CachedResponse | null>> = new Map()

  return async (ctx, next) => {
    if (!resolved.methodSet.has(ctx.method)) {
      return next()
    }

    const headerValue = readHeader(ctx, resolved.header)
    if (!headerValue || headerValue.length === 0) {
      return next()
    }

    const scope = resolved.scope(ctx)
    const cacheKey = `${scope}:${ctx.method}:${ctx.path}:${headerValue}`

    // 1. Persisted cache hit?
    const existing = await resolved.store.get(cacheKey)
    if (existing) {
      replay(ctx, existing)
      return
    }

    // 2. In-flight from a concurrent request?
    const pending = inflight.get(cacheKey)
    if (pending) {
      const result = await pending
      if (result) {
        replay(ctx, result)
        return
      }
      // First request wasn't cacheable — fall through and run the handler.
    }

    // 3. Cache miss + no in-flight: take ownership.
    let resolveInflight!: (value: CachedResponse | null) => void
    const ownPromise = new Promise<CachedResponse | null>((res) => { resolveInflight = res })
    inflight.set(cacheKey, ownPromise)

    try {
      await next()
      const captured = snapshot(ctx)
      if (captured) {
        await resolved.store.set(cacheKey, captured, resolved.ttlMs)
      }
      resolveInflight(captured)
    } catch (err) {
      // Don't cache failures — clear the in-flight slot so retries can run
      // the handler fresh, and let the error propagate.
      resolveInflight(null)
      throw err
    } finally {
      inflight.delete(cacheKey)
    }
  }
}
