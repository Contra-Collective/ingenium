import { createPublicKey, type KeyObject } from 'node:crypto'

/**
 * In-memory JWKS cache.
 *
 * One entry per URL. Each entry holds the parsed `Map<kid, KeyObject>` and
 * the absolute timestamp at which it expires. A `pending` promise is stored
 * alongside so concurrent callers for the same URL share a single in-flight
 * fetch — we never stampede the upstream IdP.
 */
interface CacheEntry {
  keys: Map<string, KeyObject>
  expiresAt: number
  pending: Promise<Map<string, KeyObject>> | null
}

const cache = new Map<string, CacheEntry>()

/** JWK shape we accept. We tolerate extra fields and ignore unsupported `kty`. */
interface Jwk {
  kty?: string
  kid?: string
  use?: string
  alg?: string
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
  // RSA private parts / EC `d` are intentionally ignored — verifier-only.
  [k: string]: unknown
}

interface JwksResponse {
  keys?: Jwk[]
}

/**
 * Fetch + cache a JWKS. Returns a `Map<kid, KeyObject>`.
 *
 * Concurrency: if a fetch is already in flight for `url` we await the same
 * promise, ensuring a thundering-herd of requests collapses to one upstream
 * call. After the fetch resolves, all waiters get the same keys.
 *
 * Failure mode: any thrown error (network, JSON parse, malformed JWK, empty
 * keyset) bubbles as a generic `Error('jwks_fetch_failed')` — the caller is
 * responsible for translating to a wire-safe `IngeniumUnauthorizedError`. We
 * deliberately do NOT serve a stale cache on failure: stale public keys can
 * mean accepting tokens that the IdP has rotated away from.
 */
export async function fetchJwks(url: string, ttlMs: number): Promise<Map<string, KeyObject>> {
  const now = Date.now()
  const entry = cache.get(url)

  // Fresh cache hit — return synchronously-resolved map.
  if (entry && entry.expiresAt > now && !entry.pending) {
    return entry.keys
  }

  // In-flight coalescing: another caller already triggered the fetch.
  if (entry?.pending) {
    return entry.pending
  }

  const pending = doFetch(url).then(
    (keys) => {
      cache.set(url, { keys, expiresAt: Date.now() + ttlMs, pending: null })
      return keys
    },
    (err) => {
      // Drop the failed entry so the next caller retries (instead of being
      // pinned to a rejected promise forever).
      cache.delete(url)
      throw err
    },
  )

  // Park the in-flight promise so concurrent callers within this tick share it.
  // Preserve the existing `keys` map so reads during refresh have something
  // to fall back on if needed (currently unused — we always await `pending`).
  cache.set(url, {
    keys: entry?.keys ?? new Map(),
    expiresAt: entry?.expiresAt ?? 0,
    pending,
  })

  return pending
}

/** Reset the in-process cache. Tests use this; production code shouldn't need it. */
export function clearJwksCache(): void {
  cache.clear()
}

async function doFetch(url: string): Promise<Map<string, KeyObject>> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('jwks_fetch_failed')
  }
  if (!res.ok) throw new Error('jwks_fetch_failed')

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new Error('jwks_fetch_failed')
  }

  if (!body || typeof body !== 'object') throw new Error('jwks_fetch_failed')
  const jwks = body as JwksResponse
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    throw new Error('jwks_fetch_failed')
  }

  const out = new Map<string, KeyObject>()
  for (const jwk of jwks.keys) {
    if (!jwk || typeof jwk !== 'object') continue
    if (typeof jwk.kid !== 'string' || jwk.kid.length === 0) continue
    if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') continue
    // EC: only accept the JWT-spec curves. P-521 (note: 521, not 512) is
    // the curve name JOSE uses for ES512 — yes, the off-by-one is in the spec.
    if (jwk.kty === 'EC' && jwk.crv !== 'P-256' && jwk.crv !== 'P-384' && jwk.crv !== 'P-521') {
      continue
    }
    try {
      // node:crypto accepts JWK directly when format is 'jwk'. For RSA it
      // needs `n` + `e`; for EC it needs `crv` + `x` + `y`. Private fields
      // are ignored when we createPublicKey.
      const key = createPublicKey({ key: jwk as never, format: 'jwk' })
      out.set(jwk.kid, key)
    } catch {
      // Skip individual bad keys rather than failing the whole keyset —
      // an IdP rolling a new (broken) key shouldn't blow up verification of
      // tokens signed with the still-valid old keys.
      continue
    }
  }

  if (out.size === 0) throw new Error('jwks_fetch_failed')
  return out
}
