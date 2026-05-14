import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { RedisIdempotencyStore } from '../src/idempotency.ts'
import { FakeRedisClient } from './fake-client.ts'

describe('RedisIdempotencyStore', () => {
  it('round-trips a string body', async () => {
    const store = new RedisIdempotencyStore({ client: new FakeRedisClient() })
    await store.set(
      'k1',
      { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":1}' },
      60_000,
    )
    const got = await store.get('k1')
    expect(got).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":1}',
    })
  })

  it('round-trips a Buffer body without corrupting binary data', async () => {
    const store = new RedisIdempotencyStore({ client: new FakeRedisClient() })
    const body = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x01])
    await store.set(
      'k2',
      { statusCode: 200, headers: { 'content-type': 'application/octet-stream' }, body },
      60_000,
    )
    const got = await store.get('k2')
    expect(got?.body).toBeInstanceOf(Buffer)
    expect((got!.body as Buffer).equals(body)).toBe(true)
  })

  it('round-trips a null body (204 No Content)', async () => {
    const store = new RedisIdempotencyStore({ client: new FakeRedisClient() })
    await store.set('k3', { statusCode: 204, headers: {}, body: null }, 60_000)
    expect((await store.get('k3'))?.body).toBeNull()
  })

  it('expires entries when PX elapses', async () => {
    const client = new FakeRedisClient()
    const store = new RedisIdempotencyStore({ client })
    await store.set('k4', { statusCode: 200, headers: {}, body: 'x' }, 50)
    client.now = () => Date.now() + 51
    expect(await store.get('k4')).toBeNull()
  })

  it('delete removes the entry', async () => {
    const store = new RedisIdempotencyStore({ client: new FakeRedisClient() })
    await store.set('k5', { statusCode: 200, headers: {}, body: 'x' }, 60_000)
    await store.delete('k5')
    expect(await store.get('k5')).toBeNull()
  })

  it('survives malformed JSON in the store', async () => {
    const client = new FakeRedisClient()
    await client.set('riftex:idem:bad', '{not-json')
    const store = new RedisIdempotencyStore({ client })
    expect(await store.get('bad')).toBeNull()
  })
})
