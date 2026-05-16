/**
 * `computeEtag(body, weak?)` — sha1-based entity tag for response bodies.
 *
 * Format: `W/"<sha1-base64-without-padding>"` (weak) or `"<sha1-base64-without-padding>"`.
 * Weak is the default — fine for JSON where serialization may legitimately vary
 * (key order, whitespace) without representing a different resource.
 *
 * The empty-body ETag is special-cased to a fixed constant so two empty
 * bodies always compare equal without pumping through the hash.
 */

import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'

/** Pre-computed sha1("") base64 → `2jmj7l5rSw0yVb/vlWAYkK/YBwk=`. */
const EMPTY_HASH = '2jmj7l5rSw0yVb/vlWAYkK/YBwk='

/**
 * Compute an ETag for the given body. Strings are treated as UTF-8.
 * @param body  Response body — usually `JSON.stringify(...)` or a `Buffer`.
 * @param weak  Prefix the tag with `W/`. Defaults to `true` for JSON safety.
 */
export function computeEtag(body: string | Buffer, weak = true): string {
  const len = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length
  if (len === 0) return weak ? `W/"${EMPTY_HASH}"` : `"${EMPTY_HASH}"`
  const hash = createHash('sha1').update(body as Buffer | string).digest('base64')
  // Trim trailing `=` padding for compactness — keeps tag URL-safe-ish and shorter.
  const trimmed = hash.replace(/=+$/g, '')
  return weak ? `W/"${trimmed}"` : `"${trimmed}"`
}
