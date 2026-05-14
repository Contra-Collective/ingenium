import { describe, it, expect } from 'vitest'
import { RedisRateLimitStore } from '../src/rate-limit.ts'
import { FakeRedisClient } from './fake-client.ts'

describe('RedisRateLimitStore', () => {
  it('starts a fresh window at count=1 and sets the TTL on first hit', async () => {
    const client = new FakeRedisClient()
    const store = new RedisRateLimitStore({ client })
    const before = Date.now()
    const r = await store.hit('user-1', 60_000)
    expect(r.count).toBe(1)
    // resetAt should land within the window
    expect(r.resetAt).toBeGreaterThanOrEqual(before)
    expect(r.resetAt).toBeLessThanOrEqual(before + 60_000 + 50)
  })

  it('increments the count on subsequent hits in the same window', async () => {
    const store = new RedisRateLimitStore({ client: new FakeRedisClient() })
    expect((await store.hit('user-2', 60_000)).count).toBe(1)
    expect((await store.hit('user-2', 60_000)).count).toBe(2)
    expect((await store.hit('user-2', 60_000)).count).toBe(3)
  })

  it('rolls the window over once the TTL elapses', async () => {
    const client = new FakeRedisClient()
    const store = new RedisRateLimitStore({ client })
    await store.hit('user-3', 100)
    await store.hit('user-3', 100)
    client.now = () => Date.now() + 101
    const r = await store.hit('user-3', 100)
    expect(r.count).toBe(1)
  })

  it('isolates counts across distinct keys', async () => {
    const store = new RedisRateLimitStore({ client: new FakeRedisClient() })
    await store.hit('a', 60_000)
    await store.hit('a', 60_000)
    expect((await store.hit('b', 60_000)).count).toBe(1)
  })

  it('reset clears the counter', async () => {
    const store = new RedisRateLimitStore({ client: new FakeRedisClient() })
    await store.hit('user-4', 60_000)
    await store.hit('user-4', 60_000)
    await store.reset('user-4')
    expect((await store.hit('user-4', 60_000)).count).toBe(1)
  })

  it('honours the configured prefix', async () => {
    const client = new FakeRedisClient()
    const store = new RedisRateLimitStore({ client, prefix: 'myapp:rl:' })
    await store.hit('user-5', 60_000)
    expect(await client.get('myapp:rl:user-5')).not.toBeNull()
    expect(await client.get('riftex:rl:user-5')).toBeNull()
  })
})
