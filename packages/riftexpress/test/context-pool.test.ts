import { describe, it, expect } from 'vitest'
import { RiftexContextPool } from '../src/context/pool.ts'
import { RiftexContext } from '../src/context/context.ts'

describe('RiftexContextPool', () => {
  it('acquire returns a fresh RiftexContext when empty', () => {
    const pool = new RiftexContextPool(8)
    const ctx = pool.acquire()
    expect(ctx).toBeInstanceOf(RiftexContext)
    expect(pool.size).toBe(0)
  })

  it('release returns the context to the free list', () => {
    const pool = new RiftexContextPool(8)
    const ctx = pool.acquire()
    pool.release(ctx)
    expect(pool.size).toBe(1)
    // Acquire again — should reuse the same instance.
    const ctx2 = pool.acquire()
    expect(ctx2).toBe(ctx)
    expect(pool.size).toBe(0)
  })

  it('release resets all per-request fields', () => {
    const pool = new RiftexContextPool(8)
    const ctx = pool.acquire()
    ctx.method = 'POST'
    ctx.url = '/foo?bar=baz'
    ctx.path = '/foo'
    ctx.rawQuery = 'bar=baz'
    ctx.headers = { 'x-custom': 'yes' }
    ctx.params = { id: '42' } as Record<string, string>
    ctx.state.user = { id: 1 }
    ctx.status(500).set('X-Test', 'v')
    ctx.json({ ok: true })

    pool.release(ctx)

    expect(ctx.method).toBe('GET')
    expect(ctx.url).toBe('/')
    expect(ctx.path).toBe('/')
    expect(ctx.rawQuery).toBe('')
    expect(ctx.headers).toEqual({})
    expect(Object.keys(ctx.params)).toEqual([])
    expect(Object.keys(ctx.state)).toEqual([])
    expect(ctx._statusCode).toBe(200)
    expect(ctx._written).toBe(false)
    expect(ctx._body).toEqual({ kind: 'none' })
    expect(ctx.getHeader('X-Test')).toBeUndefined()
  })

  it('respects max size — overflow contexts are discarded', () => {
    const pool = new RiftexContextPool(2)
    const a = pool.acquire()
    const b = pool.acquire()
    const c = pool.acquire()
    pool.release(a)
    pool.release(b)
    expect(pool.size).toBe(2)
    pool.release(c) // should be discarded
    expect(pool.size).toBe(2)
  })

  it('size getter reflects current free-list length', () => {
    const pool = new RiftexContextPool(4)
    expect(pool.size).toBe(0)
    // Acquire two distinct fresh contexts THEN release both — that grows size.
    const a = pool.acquire()
    const b = pool.acquire()
    expect(pool.size).toBe(0) // both came from fresh allocs
    pool.release(a)
    expect(pool.size).toBe(1)
    pool.release(b)
    expect(pool.size).toBe(2)
    pool.acquire() // pop one
    expect(pool.size).toBe(1)
  })

  it('acquire after pool overflow still allocates fresh contexts', () => {
    const pool = new RiftexContextPool(1)
    const a = pool.acquire()
    pool.release(a) // pool size = 1
    const b = pool.acquire() // reused (a)
    const c = pool.acquire() // pool empty -> fresh
    expect(b).toBe(a)
    expect(c).not.toBe(a)
    expect(c).toBeInstanceOf(RiftexContext)
  })

  it('default constructor admits at least 10 released contexts', () => {
    const pool = new RiftexContextPool()
    // Acquire all first (each is a fresh alloc since pool starts empty),
    // then release them — only release grows the free list.
    const ctxs = Array.from({ length: 10 }, () => pool.acquire())
    expect(pool.size).toBe(0)
    for (const c of ctxs) pool.release(c)
    expect(pool.size).toBe(10)
  })
})
