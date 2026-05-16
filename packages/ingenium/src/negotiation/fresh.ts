/**
 * `isFresh(reqHeaders, resHeaders)` — RFC 7232 conditional-request evaluator.
 *
 * Returns `true` when the response can be considered fresh relative to the
 * client's cached copy, i.e. a `304 Not Modified` is appropriate. This is
 * the engine behind `ctx.fresh` / `ctx.stale`.
 *
 * Decision matrix:
 *   - `If-None-Match` present → compare against response `ETag`. Wildcard
 *     `*` matches any current representation. Strong/weak prefixes are
 *     normalized away (per RFC 7232 §2.3.2 weak-comparison rules).
 *   - Else if `If-Modified-Since` present → compare against response
 *     `Last-Modified` (or fall back to `Date`). Fresh when the resource has
 *     not been modified since.
 *   - Otherwise → not fresh (no precondition to evaluate).
 *
 * Methods other than GET/HEAD are not handled here — callers should gate
 * on method themselves (Express does the same in `req.fresh`).
 */

/** Header bag shape — accepts both incoming-request and stored-response styles. */
export type HeaderBag = Record<string, string | string[] | undefined>

function getHeader(bag: HeaderBag, name: string): string | undefined {
  const lower = name.toLowerCase()
  const v = bag[lower]
  if (v === undefined) {
    // Try original-case key as fallback.
    const alt = bag[name]
    if (alt === undefined) return undefined
    return Array.isArray(alt) ? alt.join(',') : alt
  }
  return Array.isArray(v) ? v.join(',') : v
}

/** Strip a leading `W/` weak prefix and surrounding double-quotes. */
function normalizeEtag(tag: string): string {
  let t = tag.trim()
  if (t.startsWith('W/') || t.startsWith('w/')) t = t.slice(2)
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, t.length - 1)
  return t
}

/** Split an `If-None-Match` header value into individual ETag tokens. */
function splitInm(header: string): string[] {
  return header.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

/**
 * Returns `true` when the response is fresh w.r.t. the client's preconditions.
 */
export function isFresh(reqHeaders: HeaderBag, resHeaders: HeaderBag): boolean {
  const ifNoneMatch = getHeader(reqHeaders, 'if-none-match')
  const ifModifiedSince = getHeader(reqHeaders, 'if-modified-since')

  // No conditional headers → cannot be fresh.
  if (!ifNoneMatch && !ifModifiedSince) return false

  // Cache-Control: no-cache on the request explicitly disables 304.
  const reqCacheControl = getHeader(reqHeaders, 'cache-control')
  if (reqCacheControl && /(?:^|,)\s*no-cache\s*(?:,|$)/i.test(reqCacheControl)) {
    return false
  }

  // ───── If-None-Match takes precedence ─────
  if (ifNoneMatch) {
    if (ifNoneMatch.trim() === '*') return true
    const etag = getHeader(resHeaders, 'etag')
    if (!etag) return false
    const target = normalizeEtag(etag)
    for (const candidate of splitInm(ifNoneMatch)) {
      if (normalizeEtag(candidate) === target) return true
    }
    return false
  }

  // ───── Fallback: If-Modified-Since ─────
  if (ifModifiedSince) {
    const lastModified = getHeader(resHeaders, 'last-modified') ?? getHeader(resHeaders, 'date')
    if (!lastModified) return false
    const sinceMs = Date.parse(ifModifiedSince)
    const lastMs = Date.parse(lastModified)
    if (!Number.isFinite(sinceMs) || !Number.isFinite(lastMs)) return false
    // Fresh when resource hasn't changed since the client's copy.
    return lastMs <= sinceMs
  }

  return false
}
