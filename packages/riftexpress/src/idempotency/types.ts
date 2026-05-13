import type { Buffer } from 'node:buffer'
import type { RiftexContext } from '../context/context.ts'
import type { HttpMethod } from '../router/types.ts'

/**
 * A frozen snapshot of an outgoing response. Captured AFTER the handler
 * runs and stored in the idempotency cache for replay on retry.
 *
 * `body` is `null` only for empty responses (e.g. 204).
 */
export interface CachedResponse {
  /** HTTP status code from the original response. */
  statusCode: number
  /** Plain header bag (lowercased keys), copied from `ctx._headers`. */
  headers: Record<string, string | string[]>
  /** Serialized body. `null` when the original response had no body. */
  body: string | Buffer | null
}

/**
 * Pluggable storage for the idempotency cache. Default impl is in-memory;
 * swap for Redis/etc. when running multiple replicas.
 */
export interface IdempotencyStore {
  /** Returns the cached response for `key` or `null` if missing/expired. */
  get(key: string): Promise<CachedResponse | null>
  /** Persist `value` under `key` for `ttlMs` milliseconds. */
  set(key: string, value: CachedResponse, ttlMs: number): Promise<void>
  /** Remove `key`. Idempotent — does nothing if absent. */
  delete(key: string): Promise<void>
}

/** Options accepted by `riftex.idempotency(...)`. */
export interface IdempotencyOptions {
  /**
   * Header name carrying the idempotency key. Comparison is
   * case-insensitive (Node lowercases header names automatically).
   * Default `'Idempotency-Key'`.
   */
  header?: string

  /** Backing cache. Default: an in-process `IdempotencyMemoryStore`. */
  store?: IdempotencyStore

  /**
   * Time-to-live for cached responses, in seconds. After this elapses, the
   * same key replays nothing and the handler runs again. Default `86400`
   * (24h) — matches Stripe's documented behavior.
   */
  ttlSeconds?: number

  /**
   * Namespace function — distinguishes keys belonging to different callers
   * so two clients can independently use the same idempotency-key string.
   * Default uses the `Authorization` header (or `'anon'` when absent).
   */
  scope?: (ctx: RiftexContext) => string

  /**
   * HTTP methods eligible for idempotency caching. Default: `['POST',
   * 'PATCH', 'DELETE']` — only mutating methods. Safe methods (GET/HEAD/
   * OPTIONS) and idempotent-by-spec PUT are skipped by default; opt in by
   * extending this list if you need PUT semantics cached too.
   */
  methods?: readonly HttpMethod[]
}

/** Resolved options after defaults have been applied. Internal. */
export interface ResolvedIdempotencyOptions {
  header: string
  store: IdempotencyStore
  ttlMs: number
  scope: (ctx: RiftexContext) => string
  methodSet: ReadonlySet<HttpMethod>
}
