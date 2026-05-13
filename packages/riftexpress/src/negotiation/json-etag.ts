/**
 * `respondJsonWithEtag(ctx, body, opts)` — JSON response with auto ETag and
 * 304 short-circuit when `If-None-Match` matches.
 *
 * Behavior:
 *   1. Stringify `body` to JSON exactly once.
 *   2. Compute weak ETag (default) over the stringified bytes.
 *   3. If `If-None-Match` (after weak normalization) matches → set 304,
 *      clear body, mark written. Skip writing the JSON.
 *   4. Otherwise: set `ETag` + `Content-Type` headers, write the body via
 *      the same internal shape `ctx.json` uses, and mark written.
 *
 * Uses the lower-level shape from `RiftexContext` directly (rather than
 * calling `ctx.json`) so the JSON.stringify result can be reused without
 * a second pass.
 */

import type { IncomingHttpHeaders } from 'node:http'
import { computeEtag } from './etag.ts'
import type { ResponseBody } from '../context/context.ts'

/** Options for `respondJsonWithEtag`. */
export interface JsonEtagOptions {
  /** Prefix the ETag with `W/`. Defaults to `true`. */
  weak?: boolean
  /** HTTP status to use for the success path. Defaults to `200`. */
  status?: number
}

/**
 * Minimal context shape required by `respondJsonWithEtag` — keeps the
 * helper testable with a plain stub and avoids a hard import cycle on
 * the full `RiftexContext` class.
 */
export interface JsonEtagCtx {
  headers: IncomingHttpHeaders
  _statusCode: number
  _headers: Record<string, string | string[]>
  _body: ResponseBody
  _written: boolean
}

/** Strip `W/` and quotes for weak-comparison equality. */
function normalizeEtag(tag: string): string {
  let t = tag.trim()
  if (t.startsWith('W/') || t.startsWith('w/')) t = t.slice(2)
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, t.length - 1)
  return t
}

function ifNoneMatchHas(header: string, target: string): boolean {
  if (header.trim() === '*') return true
  const want = normalizeEtag(target)
  for (const part of header.split(',')) {
    const candidate = part.trim()
    if (candidate.length === 0) continue
    if (normalizeEtag(candidate) === want) return true
  }
  return false
}

export function respondJsonWithEtag(
  ctx: JsonEtagCtx,
  body: unknown,
  opts: JsonEtagOptions = {},
): void {
  const weak = opts.weak ?? true
  const status = opts.status ?? 200
  const serialized = JSON.stringify(body)
  const etag = computeEtag(serialized, weak)

  const inm = ctx.headers['if-none-match']
  const inmStr = Array.isArray(inm) ? inm.join(',') : inm
  if (typeof inmStr === 'string' && inmStr.length > 0 && ifNoneMatchHas(inmStr, etag)) {
    // Short-circuit: cache hit.
    ctx._statusCode = 304
    ctx._headers['etag'] = etag
    // 304 must not carry a body.
    ctx._body = { kind: 'none' }
    ctx._written = true
    return
  }

  ctx._statusCode = status
  ctx._headers['etag'] = etag
  if (!ctx._headers['content-type']) {
    ctx._headers['content-type'] = 'application/json; charset=utf-8'
  }
  ctx._body = { kind: 'string', data: serialized }
  ctx._written = true
}
