import { Buffer } from 'node:buffer'
import type { CachedResponse, IdempotencyStore } from 'riftexpress'
import type { RedisClientLike } from './client.ts'

/**
 * Wire-format envelope used to JSON-encode a {@link CachedResponse} for
 * storage. Buffers are base64-encoded with a tag so we can faithfully restore
 * them on read — JSON.stringify of a Buffer would otherwise serialize as
 * `{ type: 'Buffer', data: [...] }`, which we'd have to special-case anyway.
 */
interface Envelope {
  /** statusCode */
  s: number
  /** headers */
  h: Record<string, string | string[]>
  /** body: null | string | base64-Buffer */
  b: null | { t: 's'; v: string } | { t: 'b'; v: string }
}

function encode(value: CachedResponse): string {
  let body: Envelope['b'] = null
  if (Buffer.isBuffer(value.body)) {
    body = { t: 'b', v: value.body.toString('base64') }
  } else if (typeof value.body === 'string') {
    body = { t: 's', v: value.body }
  }
  const env: Envelope = { s: value.statusCode, h: value.headers, b: body }
  return JSON.stringify(env)
}

function decode(raw: string): CachedResponse | null {
  let env: Envelope
  try {
    env = JSON.parse(raw) as Envelope
  } catch {
    return null
  }
  if (env === null || typeof env !== 'object') return null
  let body: CachedResponse['body'] = null
  if (env.b !== null) {
    body = env.b.t === 'b' ? Buffer.from(env.b.v, 'base64') : env.b.v
  }
  return { statusCode: env.s, headers: env.h, body }
}

export interface RedisIdempotencyStoreOptions {
  /** Connected Redis client. Caller owns lifecycle. */
  client: RedisClientLike
  /** Key prefix for every entry. Default `'riftex:idem:'`. */
  prefix?: string
}

/**
 * Redis-backed {@link IdempotencyStore}. Cached responses are JSON-serialized
 * (with Buffer bodies base64-encoded) and stored with `SET ... PX` so Redis
 * owns expiry. Suitable for multi-replica deployments where the replica that
 * served the original request may not be the one handling the retry.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly client: RedisClientLike
  private readonly prefix: string

  constructor(opts: RedisIdempotencyStoreOptions) {
    this.client = opts.client
    this.prefix = opts.prefix ?? 'riftex:idem:'
  }

  async get(key: string): Promise<CachedResponse | null> {
    const raw = await this.client.get(this.prefix + key)
    if (raw === null) return null
    return decode(raw)
  }

  async set(key: string, value: CachedResponse, ttlMs: number): Promise<void> {
    await this.client.set(this.prefix + key, encode(value), { PX: ttlMs })
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.prefix + key)
  }
}
