import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { IngeniumContext } from '../src/context/context.ts'

describe('IngeniumContext response helpers', () => {
  it('status() and set()/setHeader() are chainable and return `this`', () => {
    const ctx = new IngeniumContext()
    const ret = ctx.status(201).set('X-A', '1').setHeader('X-B', '2')
    expect(ret).toBe(ctx)
    expect(ctx._statusCode).toBe(201)
    expect(ctx.getHeader('x-a')).toBe('1')
    expect(ctx.getHeader('x-b')).toBe('2')
  })

  it('getHeader is case-insensitive', () => {
    const ctx = new IngeniumContext()
    ctx.set('Content-Type', 'application/json')
    expect(ctx.getHeader('content-type')).toBe('application/json')
    expect(ctx.getHeader('CONTENT-TYPE')).toBe('application/json')
    expect(ctx.getHeader('Content-Type')).toBe('application/json')
  })

  it('json() serializes body, sets content-type and _written', () => {
    const ctx = new IngeniumContext()
    ctx.json({ ok: true }, 201)
    expect(ctx._statusCode).toBe(201)
    expect(ctx._body).toEqual({ kind: 'string', data: JSON.stringify({ ok: true }) })
    expect(ctx.getHeader('content-type')).toBe('application/json; charset=utf-8')
    expect(ctx._written).toBe(true)
  })

  it('text() sets text/plain content-type', () => {
    const ctx = new IngeniumContext()
    ctx.text('hello')
    expect(ctx._body).toEqual({ kind: 'string', data: 'hello' })
    expect(ctx.getHeader('content-type')).toBe('text/plain; charset=utf-8')
    expect(ctx._written).toBe(true)
  })

  it('html() sets text/html content-type', () => {
    const ctx = new IngeniumContext()
    ctx.html('<h1>Hi</h1>', 200)
    expect(ctx._body).toEqual({ kind: 'string', data: '<h1>Hi</h1>' })
    expect(ctx.getHeader('content-type')).toBe('text/html; charset=utf-8')
  })

  it('redirect() defaults to 302 and writes Location header', () => {
    const ctx = new IngeniumContext()
    ctx.redirect('/login')
    expect(ctx._statusCode).toBe(302)
    expect(ctx.getHeader('location')).toBe('/login')
    expect(ctx._body).toEqual({ kind: 'none' })
    expect(ctx._written).toBe(true)

    const ctx2 = new IngeniumContext()
    ctx2.redirect('/permanent', 301)
    expect(ctx2._statusCode).toBe(301)
  })

  it('send() picks string vs buffer body kind based on input', () => {
    const a = new IngeniumContext()
    a.send('plain')
    expect(a._body).toEqual({ kind: 'string', data: 'plain' })
    expect(a.getHeader('content-type')).toBe('text/plain; charset=utf-8')

    const b = new IngeniumContext()
    const buf = Buffer.from([1, 2, 3])
    b.send(buf, 202)
    expect(b._body).toEqual({ kind: 'buffer', data: buf })
    expect(b._statusCode).toBe(202)
    expect(b.getHeader('content-type')).toBe('application/octet-stream')
  })

  it('stream() stores the Readable and only sets content-type if provided', () => {
    const r = Readable.from(['chunk'])
    const ctx = new IngeniumContext()
    ctx.stream(r, 'text/event-stream')
    expect(ctx._body).toEqual({ kind: 'stream', data: r })
    expect(ctx.getHeader('content-type')).toBe('text/event-stream')
    expect(ctx._written).toBe(true)

    const ctx2 = new IngeniumContext()
    ctx2.stream(Readable.from(['x']))
    expect(ctx2.getHeader('content-type')).toBeUndefined()
  })

  it('explicit content-type set before json() is preserved', () => {
    const ctx = new IngeniumContext()
    ctx.set('Content-Type', 'application/vnd.api+json')
    ctx.json({ ok: 1 })
    expect(ctx.getHeader('content-type')).toBe('application/vnd.api+json')
  })

  it('query is lazily parsed from rawQuery and cached', () => {
    const ctx = new IngeniumContext()
    ctx.rawQuery = 'a=1&b=2&a=3'
    const q1 = ctx.query
    expect(q1).toBeInstanceOf(URLSearchParams)
    expect(q1.getAll('a')).toEqual(['1', '3'])
    expect(q1.get('b')).toBe('2')
    const q2 = ctx.query
    expect(q2).toBe(q1) // cached
  })

  it('default params is the frozen empty object', () => {
    const ctx = new IngeniumContext()
    expect(ctx.params).toEqual({})
    expect(Object.isFrozen(ctx.params)).toBe(true)
  })
})
