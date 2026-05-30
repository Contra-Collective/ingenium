import { describe, it, expect } from 'vitest'
import { Readable, Writable } from 'node:stream'
import { Buffer } from 'node:buffer'
import cors from 'cors'
import helmet from 'helmet'
import { IngeniumContext, type IngeniumMiddleware } from 'ingenium'
import { expressCompat } from '../src/index.ts'

function makeCtx(
  init?: Partial<{ method: string; url: string; path: string; rawQuery: string; headers: Record<string, string> }>,
): IngeniumContext {
  const ctx = new IngeniumContext()
  if (init?.method) ctx.method = init.method as IngeniumContext['method']
  if (init?.url) ctx.url = init.url
  if (init?.path) ctx.path = init.path
  if (init?.rawQuery) ctx.rawQuery = init.rawQuery
  if (init?.headers) ctx.headers = init.headers
  return ctx
}

const noopNext = (): Promise<void> => Promise.resolve()

describe('expressCompat — header/flow behavior', () => {
  it('cors() sets Access-Control-Allow-Origin header on the ctx', async () => {
    const mw = expressCompat(cors())
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x', headers: { origin: 'https://example.com' } })
    await mw(ctx, noopNext)
    expect(ctx.getHeader('access-control-allow-origin')).toBe('*')
  })

  it('helmet() sets standard security headers on the ctx', async () => {
    const mw = expressCompat(helmet())
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, noopNext)
    expect(ctx.getHeader('x-content-type-options')).toBe('nosniff')
    expect(ctx.getHeader('x-frame-options')).toBeDefined()
    expect(ctx.getHeader('x-dns-prefetch-control')).toBeDefined()
  })

  it('middleware that calls next() without writing lets the Ingenium chain continue', async () => {
    let downstreamRan = false
    const mw = expressCompat((_req, res, next) => {
      res.setHeader('x-from-express', 'yes')
      next()
    })
    const downstream: IngeniumMiddleware = async (ctx: IngeniumContext) => {
      downstreamRan = true
      ctx.setHeader('x-from-ingenium', 'yes')
    }
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, () => downstream(ctx, noopNext) as Promise<void>)
    expect(downstreamRan).toBe(true)
    expect(ctx.getHeader('x-from-express')).toBe('yes')
    expect(ctx.getHeader('x-from-ingenium')).toBe('yes')
  })

  it('middleware that writes via res.json() blocks subsequent Ingenium middleware', async () => {
    let downstreamRan = false
    const mw = expressCompat((_req, res, _next) => {
      res.json({ ok: true })
    })
    const downstream: IngeniumMiddleware = async () => {
      downstreamRan = true
    }
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, () => downstream(ctx, noopNext) as Promise<void>)
    expect(downstreamRan).toBe(false)
    expect(ctx._written).toBe(true)
    expect(ctx.getHeader('content-type')).toMatch(/application\/json/)
  })

  it('middleware that calls next(err) causes the wrapped promise to reject', async () => {
    const mw = expressCompat((_req, _res, next) => {
      next(new Error('bad'))
    })
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await expect(mw(ctx, noopNext)).rejects.toThrow('bad')
  })

  it('a synchronous throw inside the middleware rejects the wrapped promise', async () => {
    const mw = expressCompat(() => {
      throw new Error('boom')
    })
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await expect(mw(ctx, noopNext)).rejects.toThrow('boom')
  })

  it('mutations to req are mirrored back into ctx.state', async () => {
    const mw = expressCompat((req, _res, next) => {
      ;(req as { user?: unknown }).user = { id: 7 }
      next()
    })
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, noopNext)
    expect(ctx.state['user']).toEqual({ id: 7 })
  })

  it('res.redirect sets Location + status and blocks the chain', async () => {
    let downstreamRan = false
    const mw = expressCompat((_req, res) => res.redirect('/login'))
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, async () => {
      downstreamRan = true
    })
    expect(downstreamRan).toBe(false)
    expect(ctx._statusCode).toBe(302)
    expect(ctx.getHeader('location')).toBe('/login')
    expect(ctx._written).toBe(true)
  })
})

describe('expressCompat — req is a real Readable', () => {
  it('streams the request body via req.on("data")/req.on("end")', async () => {
    const ctx = makeCtx({ method: 'POST', url: '/x', path: '/x', headers: { 'content-type': 'text/plain' } })
    ctx.body._attach(Readable.from([Buffer.from('hello world')]), 'text/plain', 11)

    let collected = ''
    const mw = expressCompat((req, _res, next) => {
      req.setEncoding('utf8')
      req.on('data', (c: string) => {
        collected += c
      })
      req.on('end', () => next())
    })
    await mw(ctx, noopNext)
    expect(collected).toBe('hello world')
  })

  it('req.pipe() works (the multer pattern)', async () => {
    const ctx = makeCtx({ method: 'POST', url: '/x', path: '/x' })
    ctx.body._attach(Readable.from([Buffer.from('abc'), Buffer.from('def')]), undefined, 6)

    const chunks: Buffer[] = []
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk))
        cb()
      },
    })
    await new Promise<void>((resolve, reject) => {
      const mw = expressCompat((req, _res, next) => {
        sink.on('finish', () => next())
        req.on('error', reject)
        req.pipe(sink)
      })
      ;(mw(ctx, noopNext) as Promise<void>).then(resolve, reject)
    })
    expect(Buffer.concat(chunks).toString()).toBe('abcdef')
  })

  it('exposes req.ip / req.query / req.path from the context', async () => {
    const ctx = makeCtx({ method: 'GET', url: '/u?tag=a&tag=b&q=hi', path: '/u', rawQuery: 'tag=a&tag=b&q=hi' })
    let seen: { ip: unknown; query: unknown; path: unknown } | null = null
    const mw = expressCompat((req, _res, next) => {
      seen = { ip: req.ip, query: req.query, path: req.path }
      next()
    })
    await mw(ctx, noopNext)
    expect(seen!.path).toBe('/u')
    expect(seen!.query).toEqual({ tag: ['a', 'b'], q: 'hi' })
    expect(typeof seen!.ip).toBe('string')
  })
})

describe('expressCompat — res is a real Writable/EventEmitter', () => {
  it('emits "finish" when the middleware ends the response', async () => {
    let finishFired = false
    const mw = expressCompat((_req, res) => {
      res.on('finish', () => {
        finishFired = true
      })
      res.end('done')
    })
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, noopNext)
    expect(finishFired).toBe(true)
    expect(ctx._written).toBe(true)
    expect(ctx._body).toEqual({ kind: 'buffer', data: Buffer.from('done') })
  })

  it('lets a response-transformer patch res.write/res.end and replays downstream through it', async () => {
    // The compression pattern: reassign res.write/res.end (no longer trapped),
    // then let the downstream handler write — its bytes flow through the patch.
    const mw = expressCompat((_req, res, next) => {
      const origWrite = res.write.bind(res)
      const origEnd = res.end.bind(res)
      res.write = (chunk: Buffer, ...rest: unknown[]): boolean =>
        origWrite(Buffer.from(String(chunk).toUpperCase()), ...(rest as [])) as boolean
      res.end = (chunk?: Buffer, ...rest: unknown[]): unknown =>
        chunk === undefined
          ? origEnd(...(rest as []))
          : origEnd(Buffer.from(String(chunk).toUpperCase()), ...(rest as []))
      next()
    })
    const downstream: IngeniumMiddleware = async (ctx: IngeniumContext) => {
      ctx.text('hi there')
    }
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, () => downstream(ctx, noopNext) as Promise<void>)
    expect(ctx._written).toBe(true)
    expect((ctx._body as { kind: 'buffer'; data: Buffer }).data.toString()).toBe('HI THERE')
  })

  it('setHeader/removeHeader proxy live to the context', async () => {
    const mw = expressCompat((_req, res, next) => {
      res.setHeader('x-keep', '1')
      res.setHeader('x-drop', '2')
      res.removeHeader('x-drop')
      next()
    })
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, noopNext)
    expect(ctx.getHeader('x-keep')).toBe('1')
    expect(ctx.getHeader('x-drop')).toBeUndefined()
  })
})

describe('expressCompat — options back-compat', () => {
  it('still accepts the deprecated allowKnownBroken option (ignored)', async () => {
    const mw = expressCompat((_req, _res, next) => next(), { allowKnownBroken: true })
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    let ran = false
    await mw(ctx, async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })
})
