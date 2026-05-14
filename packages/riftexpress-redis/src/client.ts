/**
 * Minimal Redis-client surface the stores rely on.
 *
 * Intentionally duck-typed against node-redis v4+ (`@redis/client`) so users
 * can pass their existing `createClient()` instance directly without an extra
 * type adapter. ioredis users can shim it in a few lines if they prefer that
 * client.
 *
 * The surface is intentionally tiny — only the commands the three stores
 * actually call. Adding methods here means tightening what a custom client
 * must implement, so resist.
 */

export interface RedisSetOptions {
  /** Set TTL in seconds. Mutually exclusive with `PX`. */
  EX?: number
  /** Set TTL in milliseconds. Mutually exclusive with `EX`. */
  PX?: number
  /** Only set if the key does not already exist. */
  NX?: boolean
}

export interface RedisClientLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: RedisSetOptions): Promise<string | null>
  del(key: string | readonly string[]): Promise<number>
  expire(key: string, seconds: number): Promise<boolean | number>
  /**
   * Run a Lua script server-side. node-redis v4 uses the `{ keys, arguments }`
   * options bag — ioredis uses positional args, so ioredis adopters need to
   * shim this method.
   */
  eval(
    script: string,
    options: { keys: readonly string[]; arguments: readonly string[] },
  ): Promise<unknown>
}
