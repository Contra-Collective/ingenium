/**
 * Redis-backed stores for RiftExpress. Drop-in replacements for the in-memory
 * defaults shipped in the core package — required for multi-instance
 * deployments where sessions, idempotency replays, and rate-limit counters
 * must share state across replicas.
 *
 * Bring your own connected client (node-redis v4+ recommended). The package
 * intentionally does not own connection lifecycle.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis'
 * import { riftex, sessionMiddleware, IdempotencyMemoryStore } from 'riftexpress'
 * import {
 *   RedisSessionStore,
 *   RedisIdempotencyStore,
 *   RedisRateLimitStore,
 * } from 'riftexpress-redis'
 *
 * const client = createClient({ url: process.env.REDIS_URL })
 * await client.connect()
 *
 * const app = riftex()
 * app.use(sessionMiddleware({
 *   secret: [process.env.SESSION_SECRET!],
 *   store: new RedisSessionStore({ client }),
 * }))
 * app.use(riftex.idempotency({ store: new RedisIdempotencyStore({ client }) }))
 * app.use(riftex.rateLimit({
 *   windowMs: 60_000,
 *   limit: 100,
 *   store: new RedisRateLimitStore({ client }),
 * }))
 * ```
 */

export { RedisSessionStore, type RedisSessionStoreOptions } from './session.ts'
export {
  RedisIdempotencyStore,
  type RedisIdempotencyStoreOptions,
} from './idempotency.ts'
export {
  RedisRateLimitStore,
  type RedisRateLimitStoreOptions,
} from './rate-limit.ts'
export type { RedisClientLike, RedisSetOptions } from './client.ts'
