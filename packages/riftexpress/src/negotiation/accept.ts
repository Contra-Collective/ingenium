/**
 * Pure parsers and matchers for HTTP `Accept`-family headers.
 *
 * Implemented from scratch — no `negotiator` / `accepts` runtime dep.
 * Used by `negotiate.ts`, `format.ts`, and downstream context helpers.
 *
 * Spec references:
 *   - RFC 9110 §12.5.1 (Accept), §12.5.2 (Accept-Charset),
 *     §12.5.4 (Accept-Encoding), §12.5.5 (Accept-Language).
 */

/** A single parsed media-range entry from an `Accept` header. */
export interface ParsedAccept {
  /** The full media-range string (lowercased), e.g. `text/html`, `text/\*`, `\*\/\*`. */
  type: string
  /** Quality factor from `;q=N`, default `1`. Out-of-range values are clamped. */
  quality: number
  /** Any other extension parameters (e.g. `level=1`). */
  params: Record<string, string>
}

/**
 * Express `accepts`-style shorthand → canonical media type.
 * Kept intentionally tiny — covers the 99% case for body responses.
 */
const SHORTHAND: Readonly<Record<string, string>> = {
  json: 'application/json',
  html: 'text/html',
  text: 'text/plain',
  xml: 'application/xml',
  form: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
  csv: 'text/csv',
  'octet-stream': 'application/octet-stream',
}

/** Resolve a shorthand (`'json'`) to its canonical mime, or pass through. */
export function expandShorthand(token: string): string {
  const lower = token.toLowerCase()
  return SHORTHAND[lower] ?? lower
}

/**
 * Parse a comma-separated `Accept`-family header into a list of entries.
 * Empty / undefined input returns an empty array. Malformed entries are
 * silently dropped (lenient parsing — same as Express).
 *
 * Result is **not** sorted; pass to `sortByPreference` if you need ordering.
 */
export function parseAcceptHeader(header: string | undefined): ParsedAccept[] {
  if (!header) return []
  const out: ParsedAccept[] = []
  // Split on commas. Header values don't allow quoted commas in this set,
  // so a plain split is safe.
  const parts = header.split(',')
  for (const raw of parts) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const segments = trimmed.split(';')
    const typeSeg = segments[0]?.trim().toLowerCase()
    if (!typeSeg) continue
    let quality = 1
    const params: Record<string, string> = {}
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i]?.trim()
      if (!seg) continue
      const eq = seg.indexOf('=')
      if (eq === -1) continue
      const key = seg.slice(0, eq).trim().toLowerCase()
      let value = seg.slice(eq + 1).trim()
      // Strip surrounding quotes if present.
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, value.length - 1)
      }
      if (key === 'q') {
        const q = Number(value)
        quality = Number.isFinite(q) ? Math.max(0, Math.min(1, q)) : 0
      } else {
        params[key] = value
      }
    }
    out.push({ type: typeSeg, quality, params })
  }
  return out
}

/**
 * Specificity score for a media-range. Higher is more specific.
 *   `*​/*`        → 0
 *   `type/*`     → 1
 *   `type/sub`   → 2 (+ #params for tie-breaking)
 */
function specificity(entry: ParsedAccept): number {
  if (entry.type === '*/*' || entry.type === '*') return 0
  if (entry.type.endsWith('/*')) return 1
  return 2 + Object.keys(entry.params).length
}

/**
 * Stable sort by RFC preference: highest q first, then most-specific first.
 * Returns a NEW array; does not mutate input.
 */
export function sortByPreference(entries: readonly ParsedAccept[]): ParsedAccept[] {
  return [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (b.e.quality !== a.e.quality) return b.e.quality - a.e.quality
      const sb = specificity(b.e)
      const sa = specificity(a.e)
      if (sb !== sa) return sb - sa
      return a.i - b.i // stable
    })
    .map((x) => x.e)
}

/** Does an offered concrete type match a parsed Accept entry (incl. wildcards)? */
function entryMatches(entry: ParsedAccept, offered: string): boolean {
  const offeredLower = offered.toLowerCase()
  if (entry.type === '*/*' || entry.type === '*') return true
  if (entry.type === offeredLower) return true
  if (entry.type.endsWith('/*')) {
    const prefix = entry.type.slice(0, -1) // keep trailing slash
    return offeredLower.startsWith(prefix)
  }
  return false
}

/**
 * Return the best match for `offered` against `acceptHeader`, or `false`.
 *
 * Matching algorithm:
 *   1. If `acceptHeader` is missing/empty → first offered wins (Express behavior).
 *   2. Walk parsed entries sorted by quality + specificity.
 *   3. For each entry (in preference order), pick the first offered that matches.
 *      Among ties at the same Accept entry, the offered's listed order wins.
 *   4. Entries with `q=0` reject — never match.
 */
export function selectBest(
  acceptHeader: string | undefined,
  offered: readonly string[],
): string | false {
  if (offered.length === 0) return false
  const expanded = offered.map(expandShorthand)
  if (!acceptHeader || acceptHeader.trim() === '') {
    return offered[0] ?? false
  }
  const sorted = sortByPreference(parseAcceptHeader(acceptHeader))
  if (sorted.length === 0) return offered[0] ?? false

  for (const entry of sorted) {
    if (entry.quality === 0) continue
    for (let i = 0; i < expanded.length; i++) {
      if (entryMatches(entry, expanded[i] as string)) {
        return offered[i] as string
      }
    }
  }
  return false
}
