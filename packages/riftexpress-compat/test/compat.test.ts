import { describe, it, expect } from 'vitest'
import cors from 'cors'
import helmet from 'helmet'
import { RiftexContext, type RiftexMiddleware } from 'riftexpress'
import { expressCompat } from '../src/index.ts'

function makeCtx(init?: Partial<{ method: string; url: string; path: string; rawQuery: string; headers: Record<string, string> }>): RiftexContext {
  const ctx = new RiftexContext()
  if (init?.method) ctx.method = init.method as RiftexContext['method']
  if (init?.url) ctx.url = init.url
  if (init?.path) ctx.path = init.path
  if (init?.rawQuery) ctx.rawQuery = init.rawQuery
  if (init?.headers) ctx.headers = init.headers
  return ctx
}

const noopNext = (): Promise<void> => Promise.resolve()

describe('expressCompat', () => {
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

  it('middleware that calls next() without writing lets the Riftex chain continue', async () => {
    let downstreamRan = false
    const mw = expressCompat((_req, res, next) => {
      // Set a header but do NOT write the response.
      res.setHeader('x-from-express', 'yes')
      next()
    })
    const downstream: RiftexMiddleware = async (ctx) => {
      downstreamRan = true
      ctx.setHeader('x-from-riftex', 'yes')
    }
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, () => downstream(ctx, noopNext) as Promise<void>)
    expect(downstreamRan).toBe(true)
    expect(ctx.getHeader('x-from-express')).toBe('yes')
    expect(ctx.getHeader('x-from-riftex')).toBe('yes')
  })

  it('middleware that writes via res.json() blocks subsequent Riftex middleware', async () => {
    let downstreamRan = false
    const mw = expressCompat((_req, res, _next) => {
      res.json({ ok: true })
    })
    const downstream: RiftexMiddleware = async () => {
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

  it('mutations to req are mirrored back into ctx.state', async () => {
    const mw = expressCompat((req, _res, next) => {
      ;(req as { user?: unknown }).user = { id: 7 }
      next()
    })
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await mw(ctx, noopNext)
    expect(ctx.state['user']).toEqual({ id: 7 })
  })
})
