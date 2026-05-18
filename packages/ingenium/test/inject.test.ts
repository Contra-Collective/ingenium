import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { IngeniumApp } from '../src/app.ts'

describe('app.inject() — in-process test client', () => {
  it('basic GET returns 200 with reflected JSON body', async () => {
    const app = new IngeniumApp()
    app.get('/hello', (ctx) => {
      ctx.json({ ok: true, msg: 'hi' })
    })

    const res = await app.inject({ method: 'GET', url: '/hello' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(res.json<{ ok: boolean; msg: string }>()).toEqual({ ok: true, msg: 'hi' })
  })

  it('defaults method to GET when omitted', async () => {
    const app = new IngeniumApp()
    app.get('/', (ctx) => {
      ctx.text(`method=${ctx.method}`)
    })

    const res = await app.inject({ url: '/' })
    expect(res.status).toBe(200)
    expect(res.body).toBe('method=GET')
  })

  it('POST with JSON object body — handler reads ctx.body.json() and echoes', async () => {
    const app = new IngeniumApp()
    app.post('/echo', async (ctx) => {
      const data = await ctx.body.json<{ a: number; b: string }>()
      ctx.json({ received: data })
    })

    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      body: { a: 42, b: 'hello' },
    })
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ received: { a: 42, b: 'hello' } })
  })

  it('auto-sets content-type: application/json when body is an object and ct not provided', async () => {
    const app = new IngeniumApp()
    app.post('/ct', (ctx) => {
      ctx.json({ ct: ctx.headers['content-type'] ?? null })
    })

    const res = await app.inject({ method: 'POST', url: '/ct', body: { x: 1 } })
    expect(res.json<{ ct: string }>().ct).toBe('application/json')
  })

  it('preserves explicit content-type when body is an object', async () => {
    const app = new IngeniumApp()
    app.post('/ct', (ctx) => {
      ctx.json({ ct: ctx.headers['content-type'] ?? null })
    })

    const res = await app.inject({
      method: 'POST',
      url: '/ct',
      headers: { 'content-type': 'application/vnd.custom+json' },
      body: { x: 1 },
    })
    expect(res.json<{ ct: string }>().ct).toBe('application/vnd.custom+json')
  })

  it('accepts string body verbatim', async () => {
    const app = new IngeniumApp()
    app.post('/str', async (ctx) => {
      const text = await ctx.body.text()
      ctx.text(`got:${text}`)
    })

    const res = await app.inject({ method: 'POST', url: '/str', body: 'hello world' })
    expect(res.status).toBe(200)
    expect(res.body).toBe('got:hello world')
  })

  it('accepts Buffer body verbatim', async () => {
    const app = new IngeniumApp()
    app.post('/buf', async (ctx) => {
      const buf = await ctx.body.buffer()
      ctx.send(buf)
    })

    const res = await app.inject({
      method: 'POST',
      url: '/buf',
      body: Buffer.from('binary-payload', 'utf8'),
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe('binary-payload')
  })

  it('accepts Uint8Array body verbatim', async () => {
    const app = new IngeniumApp()
    app.post('/u8', async (ctx) => {
      const buf = await ctx.body.buffer()
      ctx.text(buf.toString('utf8'))
    })

    const u8 = new TextEncoder().encode('uint8-bytes')
    const res = await app.inject({ method: 'POST', url: '/u8', body: u8 })
    expect(res.body).toBe('uint8-bytes')
  })

  it('returns 404 on unmatched route', async () => {
    const app = new IngeniumApp()
    app.get('/known', (ctx) => ctx.text('ok'))

    const res = await app.inject({ method: 'GET', url: '/missing' })
    expect(res.status).toBe(404)
    const body = res.json<{ error: string; code: string }>()
    expect(body.code).toBe('NOT_FOUND')
  })

  it('returns 405 on wrong method (with Allow header)', async () => {
    const app = new IngeniumApp()
    app.get('/only-get', (ctx) => ctx.text('ok'))

    const res = await app.inject({ method: 'POST', url: '/only-get' })
    expect(res.status).toBe(405)
    expect(res.headers.allow).toBeDefined()
    expect(String(res.headers.allow)).toContain('GET')
  })

  it('extracts path params correctly', async () => {
    const app = new IngeniumApp()
    app.get('/users/:id/posts/:slug', (ctx) => {
      ctx.json({ params: ctx.params })
    })

    const res = await app.inject({ method: 'GET', url: '/users/42/posts/hello-world' })
    expect(res.status).toBe(200)
    expect(res.json<{ params: Record<string, string> }>()).toEqual({
      params: { id: '42', slug: 'hello-world' },
    })
  })

  it('parses query string correctly', async () => {
    const app = new IngeniumApp()
    app.get('/q', (ctx) => {
      ctx.json({
        rawQuery: ctx.rawQuery,
        expand: ctx.query.get('expand'),
        tags: ctx.query.getAll('tag'),
      })
    })

    const res = await app.inject({ method: 'GET', url: '/q?expand=posts&tag=a&tag=b' })
    expect(res.json()).toEqual({
      rawQuery: 'expand=posts&tag=a&tag=b',
      expand: 'posts',
      tags: ['a', 'b'],
    })
  })

  it('forwards custom headers (lowercased) to the handler', async () => {
    const app = new IngeniumApp()
    app.get('/h', (ctx) => {
      ctx.json({
        auth: ctx.headers.authorization ?? null,
        x: ctx.headers['x-custom'] ?? null,
      })
    })

    const res = await app.inject({
      method: 'GET',
      url: '/h',
      headers: { Authorization: 'Bearer token', 'X-Custom': 'value' },
    })
    expect(res.json()).toEqual({ auth: 'Bearer token', x: 'value' })
  })

  it('captures response headers set by the handler', async () => {
    const app = new IngeniumApp()
    app.get('/r', (ctx) => {
      ctx.set('x-trace-id', 'abc-123')
      ctx.set('cache-control', 'no-store')
      ctx.json({ ok: true })
    })

    const res = await app.inject({ method: 'GET', url: '/r' })
    expect(res.headers['x-trace-id']).toBe('abc-123')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
  })

  it('multiple sequential inject() calls share the pool without leaking state', async () => {
    const app = new IngeniumApp()
    app.get('/counter/:n', (ctx) => {
      ctx.json({ n: ctx.params.n, prevState: ctx.state.carryover ?? null })
      // Mutate state. If the pool fails to reset, the next request would see this.
      ctx.state.carryover = `leaked-${ctx.params.n}`
    })

    const r1 = await app.inject({ method: 'GET', url: '/counter/1' })
    const r2 = await app.inject({ method: 'GET', url: '/counter/2' })
    const r3 = await app.inject({ method: 'GET', url: '/counter/3' })

    expect(r1.json()).toEqual({ n: '1', prevState: null })
    expect(r2.json()).toEqual({ n: '2', prevState: null })
    expect(r3.json()).toEqual({ n: '3', prevState: null })
  })

  it('multiple sequential inject() calls — response headers do not bleed across requests', async () => {
    const app = new IngeniumApp()
    app.get('/a', (ctx) => {
      ctx.set('x-route', 'a')
      ctx.json({})
    })
    app.get('/b', (ctx) => {
      ctx.json({})
    })

    const a = await app.inject({ method: 'GET', url: '/a' })
    const b = await app.inject({ method: 'GET', url: '/b' })

    expect(a.headers['x-route']).toBe('a')
    expect(b.headers['x-route']).toBeUndefined()
  })

  it('handles stream responses by draining to a string', async () => {
    const app = new IngeniumApp()
    app.get('/s', (ctx) => {
      ctx.stream(Readable.from(['chunk-1', '|', 'chunk-2']), 'text/plain')
    })

    const res = await app.inject({ method: 'GET', url: '/s' })
    expect(res.status).toBe(200)
    expect(res.body).toBe('chunk-1|chunk-2')
  })

  it('handles error thrown in handler via the error boundary', async () => {
    const app = new IngeniumApp()
    app.get('/boom', () => {
      throw new Error('kaboom')
    })

    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.status).toBe(500)
    expect(res.json<{ code: string }>().code).toBe('INTERNAL_ERROR')
  })

  it('honors custom remoteAddress', async () => {
    const app = new IngeniumApp()
    app.get('/ip', (ctx) => {
      ctx.json({ ip: ctx.remoteAddress })
    })

    const res = await app.inject({ method: 'GET', url: '/ip', remoteAddress: '10.0.0.42' })
    expect(res.json()).toEqual({ ip: '10.0.0.42' })
  })

  it('inject() works without registering any routes (pure 404)', async () => {
    const app = new IngeniumApp()
    const res = await app.inject({ method: 'GET', url: '/anything' })
    expect(res.status).toBe(404)
  })
})
