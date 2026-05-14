import { describe, it, expect } from 'vitest'
import { RedisSessionStore } from '../src/session.ts'
import { FakeRedisClient } from './fake-client.ts'

describe('RedisSessionStore', () => {
  it('returns null for an unknown id', async () => {
    const store = new RedisSessionStore({ client: new FakeRedisClient() })
    expect(await store.get('missing')).toBeNull()
  })

  it('round-trips a session payload', async () => {
    const store = new RedisSessionStore({ client: new FakeRedisClient() })
    await store.set('sid-1', { userId: 'u_42', count: 3 }, 60)
    expect(await store.get('sid-1')).toEqual({ userId: 'u_42', count: 3 })
  })

  it('honours the configured prefix', async () => {
    const client = new FakeRedisClient()
    const store = new RedisSessionStore({ client, prefix: 'myapp:s:' })
    await store.set('abc', { v: 1 }, 60)
    expect(await client.get('myapp:s:abc')).not.toBeNull()
    expect(await client.get('riftex:sess:abc')).toBeNull()
  })

  it('destroy removes the entry', async () => {
    const store = new RedisSessionStore({ client: new FakeRedisClient() })
    await store.set('sid-1', { v: 1 }, 60)
    await store.destroy('sid-1')
    expect(await store.get('sid-1')).toBeNull()
  })

  it('touch refreshes TTL on an existing entry', async () => {
    const client = new FakeRedisClient()
    const store = new RedisSessionStore({ client })
    await store.set('sid-1', { v: 1 }, 1)
    // Simulate "almost expired" by advancing Redis time, then touch.
    client.now = () => Date.now() + 900
    await store.touch('sid-1', 60)
    // Now jump past the original TTL — touch should have kept it alive.
    client.now = () => Date.now() + 2_000
    expect(await store.get('sid-1')).toEqual({ v: 1 })
  })

  it('survives malformed JSON in the store', async () => {
    const client = new FakeRedisClient()
    await client.set('riftex:sess:bad', 'not-json')
    const store = new RedisSessionStore({ client })
    expect(await store.get('bad')).toBeNull()
  })
})
