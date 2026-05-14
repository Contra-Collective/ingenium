# riftexpress-redis

Redis-backed stores for RiftExpress. Drop-in replacements for the in-memory defaults shipped in the core package — required as soon as you run more than one replica behind a load balancer.

```sh
npm install riftexpress riftexpress-redis redis
```

The package peer-depends on [`riftexpress`](../riftexpress) and is duck-typed against [`node-redis`](https://github.com/redis/node-redis) v4+ (`@redis/client`). ioredis users can shim the client interface in ~10 lines — see [`src/client.ts`](src/client.ts).

---

## Why this exists

The core package ships in-memory stores for sessions, idempotency, and rate-limit. They're fine for single-process development and tests, but **they don't share state across replicas**. With two pods behind a load balancer you get three concrete bugs:

| Concern | Single replica | Two+ replicas without Redis |
|---|---|---|
| Sessions | login works | request bounces to pod B → user is logged out |
| Idempotency | retry replays cached response | retry hits pod B → handler runs twice → duplicate charge |
| Rate-limit | 100 req/min enforced | each pod allows 100 → effective limit becomes `100 × replicas` |

All three stores in this package keep state in Redis so the replicas agree.

---

## Quick start

```ts
import { createClient } from 'redis'
import {
  riftex, sessionMiddleware, gracefulShutdown,
} from 'riftexpress'
import {
  RedisSessionStore,
  RedisIdempotencyStore,
  RedisRateLimitStore,
} from 'riftexpress-redis'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

const app = riftex({ trustProxy: 'loopback' })

app.use(sessionMiddleware({
  secret: [process.env.SESSION_SECRET!],
  store: new RedisSessionStore({ client: redis }),
}))

app.use(riftex.idempotency({
  store: new RedisIdempotencyStore({ client: redis }),
}))

app.use(riftex.rateLimit({
  windowMs: 60_000,
  max: 100,
  store: new RedisRateLimitStore({ client: redis }),
}))

const server = await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0')

gracefulShutdown(server, {
  gracefulTimeoutMs: 10_000,
  onShutdown: () => redis.quit(),
})
```

That's it. The three middlewares are unchanged from their in-memory examples — only the `store` option swaps.

---

## API

### `RedisSessionStore`

```ts
new RedisSessionStore({
  client: RedisClientLike,
  prefix?: string,   // default 'riftex:sess:'
})
```

Implements [`SessionStore`](../riftexpress/src/session/types.ts). Session payloads are stored as JSON; TTL is enforced by Redis via `SET ... EX`. The `touch(id, ttlSeconds)` method maps to `EXPIRE` for rolling sessions.

### `RedisIdempotencyStore`

```ts
new RedisIdempotencyStore({
  client: RedisClientLike,
  prefix?: string,   // default 'riftex:idem:'
})
```

Implements [`IdempotencyStore`](../riftexpress/src/idempotency/types.ts). Cached responses are JSON-encoded; `Buffer` bodies are tagged and base64-encoded so binary responses (e.g. images, PDFs) survive a round-trip without corruption. TTL is enforced by Redis via `SET ... PX`.

### `RedisRateLimitStore`

```ts
new RedisRateLimitStore({
  client: RedisClientLike,
  prefix?: string,   // default 'riftex:rl:'
})
```

Implements [`RateLimitStore`](../riftexpress/src/rate-limit/types.ts). Each hit runs a single Lua script server-side that does `INCR + PEXPIRE-if-new + PTTL` atomically — no race where two replicas both think they own the first hit, no race where the counter exists without a TTL.

`resetAt` is computed from `PTTL` on the server, so the value is consistent across replicas even with clock drift between them.

### `RedisClientLike`

The minimal client interface the three stores depend on. node-redis v4+ instances satisfy it directly:

```ts
interface RedisClientLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { EX?: number; PX?: number; NX?: boolean }): Promise<string | null>
  del(key: string | readonly string[]): Promise<number>
  expire(key: string, seconds: number): Promise<boolean | number>
  eval(script: string, options: { keys: readonly string[]; arguments: readonly string[] }): Promise<unknown>
}
```

### ioredis users

```ts
import Redis from 'ioredis'
import type { RedisClientLike } from 'riftexpress-redis'

const ioredis = new Redis(process.env.REDIS_URL!)

const client: RedisClientLike = {
  get: (k) => ioredis.get(k),
  set: (k, v, o) => {
    if (o?.EX !== undefined) return ioredis.set(k, v, 'EX', o.EX)
    if (o?.PX !== undefined) return ioredis.set(k, v, 'PX', o.PX)
    return ioredis.set(k, v)
  },
  del: (k) => ioredis.del(...(Array.isArray(k) ? k : [k])),
  expire: (k, s) => ioredis.expire(k, s),
  eval: (script, opts) =>
    ioredis.eval(script, opts.keys.length, ...opts.keys, ...opts.arguments),
}
```

---

## Connection lifecycle

The stores deliberately do not own the Redis connection. You're responsible for:

1. Creating the client (`createClient(...)`) — one shared instance for all three stores is correct, since node-redis pipelines internally.
2. Calling `.connect()` before using any store.
3. Wiring `client.quit()` into your graceful-shutdown hook so in-flight commands flush before the process exits.

If you're using `gracefulShutdown`, drop `onShutdown: () => redis.quit()` into its options.

---

## Sharing one client across replicas

Yes, share one `createClient()` instance per replica across all three stores. node-redis multiplexes commands onto a single connection automatically; opening three connections (one per store) just wastes file descriptors and burns connection slots on your Redis tier.

For high-throughput deployments, consider running node-redis in cluster mode and letting it shard keys across nodes; the three stores' key formats (`riftex:sess:`, `riftex:idem:`, `riftex:rl:`) are all single-key operations, so they shard cleanly.

---

## Migration from in-memory

There's no migration step for sessions or idempotency — both are ephemeral by design, and existing in-memory entries can simply be discarded at deploy time. Users will be logged out once; idempotency keys will replay until the original TTL would have expired (24h by default).

For rate-limit, switching stores resets all counters. If you care about not letting that be exploited at the deploy boundary, briefly halve `max` during the rollout.

---

## License

MIT
