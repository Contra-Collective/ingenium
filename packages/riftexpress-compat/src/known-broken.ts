/**
 * Detect-and-throw guards for Express middleware that is known to silently
 * fail (no-op, hang, or 500) when run through `expressCompat()`.
 *
 * Detection is intentionally cheap and conservative: we ONLY match against
 * the wrapped function's `.name`. Anonymous, obfuscated, or user-rewrapped
 * middleware will pass through silently — false negatives are accepted; we
 * refuse to throw on a false positive.
 *
 * The list is kept in sync with `packages/riftexpress-compat/COMPATIBILITY.md`
 * and the e2e suite at `packages/riftexpress-compat/test/e2e.test.ts`.
 */

export interface KnownBrokenEntry {
  /** Friendly package name shown in the error message. */
  pkg: string
  /** Why the shim cannot proxy it. */
  reason: string
  /** The RiftExpress-native equivalent the user should reach for. */
  native: string
}

export const KNOWN_BROKEN: Record<string, KnownBrokenEntry> = {
  jsonParser: {
    pkg: 'body-parser',
    reason:
      "it consumes the request stream via req.on('data')/req.on('end'), which the shim cannot proxy and would hang forever",
    native: 'await ctx.body.json()',
  },
  urlencodedParser: {
    pkg: 'body-parser',
    reason:
      "it consumes the request stream via req.on('data')/req.on('end'), which the shim cannot proxy and would hang forever",
    native: 'await ctx.body.urlencoded()',
  },
  textParser: {
    pkg: 'body-parser',
    reason:
      "it consumes the request stream via req.on('data')/req.on('end'), which the shim cannot proxy and would hang forever",
    native: 'await ctx.body.text()',
  },
  rawParser: {
    pkg: 'body-parser',
    reason:
      "it consumes the request stream via req.on('data')/req.on('end'), which the shim cannot proxy and would hang forever",
    native: 'await ctx.body.buffer()',
  },
  multerMiddleware: {
    pkg: 'multer',
    reason:
      'it pipes the request into busboy via req.pipe(); the req-shim is a plain object, not a Readable, so this throws mid-request',
    native: 'await ctx.body.multipart()',
  },
  session: {
    pkg: 'express-session',
    reason:
      'it monkey-patches res.end to flush Set-Cookie lazily; the shim res.end is a sync one-shot, so the cookie is never written and the session silently fails to persist',
    native: "import { sessionMiddleware } from 'riftexpress'",
  },
  compression: {
    pkg: 'compression',
    reason:
      'it patches res.write/res.end to swap in a gzip stream; neither method exists on the res-shim, so the middleware silently no-ops and responses ship uncompressed',
    native: 'gzip at the reverse proxy (nginx/Caddy/CDN)',
  },
}

export interface DetectedBroken extends KnownBrokenEntry {
  /** The matched function `.name`. */
  name: string
}

/**
 * Returns a `DetectedBroken` record if `mw` matches one of the known-broken
 * function names, otherwise `null`. Cheap: a single property read + table
 * lookup. Runs once per `expressCompat()` call, never per request.
 */
export function detectKnownBroken(mw: unknown): DetectedBroken | null {
  if (typeof mw !== 'function') return null
  const name = (mw as { name?: unknown }).name
  if (typeof name !== 'string' || name.length === 0) return null
  const entry = KNOWN_BROKEN[name]
  if (!entry) return null
  return { name, ...entry }
}

/**
 * Build the human-readable error/warning message for a detected broken
 * middleware. Kept as a standalone function so the throw path and the
 * `process.emitWarning(...)` path produce identical wording.
 */
export function formatBrokenMessage(d: DetectedBroken): string {
  return (
    `expressCompat(): refusing to wrap \`${d.pkg}\`'s ${d.name} — ${d.reason}. ` +
    `Use RiftExpress's native equivalent instead: \`${d.native}\`. ` +
    `See packages/riftexpress-compat/COMPATIBILITY.md for the full matrix. ` +
    `(To opt out and run anyway, pass \`expressCompat(mw, { allowKnownBroken: true })\`.)`
  )
}
