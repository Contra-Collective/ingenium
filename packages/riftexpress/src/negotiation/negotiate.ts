/**
 * Higher-level `accepts*` helpers, parameterized over a context-like object
 * with a `headers` map. Kept context-agnostic so they're trivially testable
 * with a plain `{ headers: {...} }` stub.
 */

import type { IncomingHttpHeaders } from 'node:http'
import { parseAcceptHeader, selectBest, expandShorthand } from './accept.ts'

/** Minimal shape we depend on — `RiftexContext` satisfies it. */
export interface NegotiableCtx {
  headers: IncomingHttpHeaders
}

function readHeader(ctx: NegotiableCtx, name: string): string | undefined {
  const v = ctx.headers[name]
  if (Array.isArray(v)) return v.join(',')
  return v
}

/**
 * `accepts(ctx)` → list of accepted media types in preference order
 * (after expanding shorthand inputs is a no-op here — it returns the raw
 * mime strings the client sent).
 *
 * `accepts(ctx, ...types)` → best matching offered type, or `false`.
 * Each `type` may be a shorthand (`'json'`, `'html'`) or full mime
 * (`'application/json'`).
 */
export function accepts(ctx: NegotiableCtx): string[]
export function accepts(ctx: NegotiableCtx, ...types: string[]): string | false
export function accepts(ctx: NegotiableCtx, ...types: string[]): string | false | string[] {
  const header = readHeader(ctx, 'accept')
  if (types.length === 0) {
    return parseAcceptHeader(header).map((e) => e.type)
  }
  const best = selectBest(header, types.map(expandShorthand))
  if (best === false) return false
  // Map the canonical match back to the caller's original token (preserves shorthand).
  for (const t of types) {
    if (expandShorthand(t) === best) return t
  }
  return best
}

/**
 * `acceptsCharsets(ctx)` → all charsets in preference order.
 * `acceptsCharsets(ctx, ...charsets)` → best match or `false`.
 */
export function acceptsCharsets(ctx: NegotiableCtx): string[]
export function acceptsCharsets(ctx: NegotiableCtx, ...charsets: string[]): string | false
export function acceptsCharsets(
  ctx: NegotiableCtx,
  ...charsets: string[]
): string | false | string[] {
  const header = readHeader(ctx, 'accept-charset')
  if (charsets.length === 0) return parseAcceptHeader(header).map((e) => e.type)
  return selectBest(header, charsets)
}

/**
 * `acceptsLanguages(ctx)` → all languages in preference order.
 * `acceptsLanguages(ctx, ...langs)` → best match or `false`.
 *
 * Language matching is treated like opaque tokens with `*` as wildcard;
 * partial-tag matching (e.g. `en` matching `en-US`) is **not** performed —
 * use exact tags for predictable behavior, mirroring Express's default.
 */
export function acceptsLanguages(ctx: NegotiableCtx): string[]
export function acceptsLanguages(ctx: NegotiableCtx, ...langs: string[]): string | false
export function acceptsLanguages(
  ctx: NegotiableCtx,
  ...langs: string[]
): string | false | string[] {
  const header = readHeader(ctx, 'accept-language')
  if (langs.length === 0) return parseAcceptHeader(header).map((e) => e.type)
  return selectBest(header, langs)
}

/**
 * `acceptsEncodings(ctx)` → all encodings in preference order.
 * `acceptsEncodings(ctx, ...encodings)` → best match or `false`.
 *
 * Per RFC 9110 §12.5.4, when `Accept-Encoding` is absent, the server
 * MAY assume the client accepts any encoding — we follow Express and
 * return the first offered.
 */
export function acceptsEncodings(ctx: NegotiableCtx): string[]
export function acceptsEncodings(ctx: NegotiableCtx, ...encodings: string[]): string | false
export function acceptsEncodings(
  ctx: NegotiableCtx,
  ...encodings: string[]
): string | false | string[] {
  const header = readHeader(ctx, 'accept-encoding')
  if (encodings.length === 0) return parseAcceptHeader(header).map((e) => e.type)
  return selectBest(header, encodings)
}
