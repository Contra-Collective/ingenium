import type { RiftexContext } from '../context/context.ts'

/**
 * Supported JWT signing algorithms in v0.0.1. Only HMAC variants are wired
 * up — RS\* / ES\* require asymmetric key handling that is intentionally out of
 * scope for this release. Asking for them at construction throws.
 */
export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512'

/** Decoded JWT header. The `alg` field is required by the spec. */
export interface JwtHeader {
  alg: string
  typ?: string
  kid?: string
  [k: string]: unknown
}

/**
 * A successfully verified JWT. `payload` carries the typed claims object,
 * `header` carries the decoded protected header, and `raw` is the original
 * compact-serialization string the client sent (useful for re-emitting).
 */
export interface JwtVerified<T = Record<string, unknown>> {
  header: JwtHeader
  payload: T
  raw: string
}

/** Internal — verifier failure mode. Public surface only ever sees `'Invalid token'`. */
export type JwtVerifyError =
  | { error: 'malformed' }
  | { error: 'unsupported_alg' }
  | { error: 'bad_signature' }
  | { error: 'expired' }
  | { error: 'not_yet_valid' }
  | { error: 'too_old' }
  | { error: 'aud_mismatch' }
  | { error: 'iss_mismatch' }

/**
 * Resolve a per-request signing secret. Receives the decoded JWT header so
 * callers can implement `kid`-based JWKS-style routing without parsing the
 * token themselves.
 */
export type JwtSecretResolver = (header: JwtHeader) => string | Promise<string>

/** All ways `secret` can be supplied. */
export type JwtSecret = string | string[] | JwtSecretResolver

/** Signature for pulling the raw compact-serialization out of the request. */
export type JwtTokenReader = (
  ctx: RiftexContext,
) => string | undefined | Promise<string | undefined>

/** Optional structured logger for redacted verification diagnostics. */
export type JwtLogger = (event: { reason: string; alg?: string }) => void

export interface JwtOptions<T = Record<string, unknown>> {
  /**
   * HMAC secret. Accepts:
   * - A single string.
   * - An array of strings (rotation — each is tried in order).
   * - A function `(header) => secret | Promise<secret>` for kid-based lookup.
   */
  secret: JwtSecret
  /** Allowed signing algorithms. Default `['HS256']`. */
  algorithms?: readonly JwtAlgorithm[]
  /** Required `aud` claim. Token's `aud` must match (or include) one of these. */
  audience?: string | readonly string[]
  /** Required `iss` claim. */
  issuer?: string | readonly string[]
  /** Reject tokens whose `iat` is older than N seconds. */
  maxAgeSeconds?: number
  /** Leeway for `nbf` / `exp` checks, in seconds. Default `5`. */
  clockSkewSeconds?: number
  /**
   * If `true` (default), missing tokens raise `RiftexUnauthorizedError`.
   * If `false`, missing tokens just call `next()` with no `ctx.jwt`.
   */
  required?: boolean
  /**
   * Custom token reader. Default reads `Authorization: Bearer <token>`.
   * Return `undefined` to indicate "no token in this request".
   */
  getToken?: JwtTokenReader
  /**
   * Optional sink for redacted verification failure reasons. Useful for
   * observability without leaking the failure type to the wire (which would
   * be an oracle for attackers).
   */
  logger?: JwtLogger
  /** Phantom — narrows `ctx.jwt.payload` for typed handlers. */
  _payload?: T
}
