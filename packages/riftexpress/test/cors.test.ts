import { describe, it, expect, vi } from 'vitest'
import { RexContext } from '../src/context/context.ts'
import { corsMiddleware } from '../src/cors/middleware.ts'
import type { HttpMethod } from '../src/router/types.ts'

function makeCtx(
  method: HttpMethod = 'GET',
  headers: Record<string, string> = {},
): RexContext {
  const ctx = new RexContext()
  ctx.method = method
  ctx.path = '/'
  ctx.url = '/'
  ctx.headers = headers
  return ctx
}

const noop = async () => {}

describe('cors middleware — simple requests', () => {
  it('default opts: simple GET stamps Access-Control-Allow-Origin: *', async () => {
    const mw = corsMiddleware()
    const ctx = makeCtx('GET', { origin: 'https://anywhere.com' })
    const next = vi.fn(noop)
    await mw(ctx, next)
    expect(ctx.getHeader('access-control-allow-origin')).toBe('*')
    // Wildcard does not vary on origin.
    expect(ctx.getHeader('vary')).toBeUndefined()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('default opts: works even without an Origin header', async () => {
    const mw = corsMiddleware()
    const ctx = makeCtx('GET', {})
    const next = vi.fn(noop)
    await mw(ctx, next)
    expect(ctx.getHeader('access-control-allow-origin')).toBe('*')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("origin: 'https://app.com' — matching request gets it back", async () => {
    const mw = corsMiddleware({ origin: 'https://app.com' })
    const ctx = makeCtx('GET', { origin: 'https://app.com' })
    await mw(ctx, vi.fn(noop))
    expect(ctx.getHeader('access-control-allow-origin')).toBe('https://app.com')
    expect(ctx.getHeader('vary')).toBe('Origin')
  })

  it("origin: 'https://app.com' — non-matching request gets nothing AND Vary: Origin", async () => {
    const mw = corsMiddleware({ origin: 'https://app.com' })
    const ctx = makeCtx('GET', { origin: 'https://evil.com' })
    const next = vi.fn(noop)
    await mw(ctx, next)
    expect(ctx.getHeader('access-control-allow-origin')).toBeUndefined()
    expect(ctx.getHeader('vary')).toBe('Origin')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('origin: array — allowlist match', async () => {
    const mw = corsMiddleware({ origin: ['https://a.com', 'https://b.com'] })

    const ctxA = makeCtx('GET', { origin: 'https://a.com' })
    await mw(ctxA, vi.fn(noop))
    expect(ctxA.getHeader('access-control-allow-origin')).toBe('https://a.com')
    expect(ctxA.getHeader('vary')).toBe('Origin')

    const ctxB = makeCtx('GET', { origin: 'https://b.com' })
    await mw(ctxB, vi.fn(noop))
    expect(ctxB.getHeader('access-control-allow-origin')).toBe('https://b.com')

    const ctxNo = makeCtx('GET', { origin: 'https://c.com' })
    await mw(ctxNo, vi.fn(noop))
    expect(ctxNo.getHeader('access-control-allow-origin')).toBeUndefined()
    expect(ctxNo.getHeader('vary')).toBe('Origin')
  })

  it('origin: regex match', async () => {
    const mw = corsMiddleware({ origin: /\.example\.com$/ })

    const ok = makeCtx('GET', { origin: 'https://api.example.com' })
    await mw(ok, vi.fn(noop))
    expect(ok.getHeader('access-control-allow-origin')).toBe('https://api.example.com')
    expect(ok.getHeader('vary')).toBe('Origin')

    const bad = makeCtx('GET', { origin: 'https://example.org' })
    await mw(bad, vi.fn(noop))
    expect(bad.getHeader('access-control-allow-origin')).toBeUndefined()
  })

  it('origin: predicate (sync)', async () => {
    const mw = corsMiddleware({
      origin: (o) => o.endsWith('.trusted.dev'),
    })

    const ok = makeCtx('GET', { origin: 'https://app.trusted.dev' })
    await mw(ok, vi.fn(noop))
    expect(ok.getHeader('access-control-allow-origin')).toBe('https://app.trusted.dev')

    const bad = makeCtx('GET', { origin: 'https://app.untrusted.dev' })
    await mw(bad, vi.fn(noop))
    expect(bad.getHeader('access-control-allow-origin')).toBeUndefined()
  })

  it('origin: predicate (async)', async () => {
    const mw = corsMiddleware({
      origin: async (o) => {
        await Promise.resolve()
        return o.endsWith('.trusted.dev')
      },
    })

    const ok = makeCtx('GET', { origin: 'https://app.trusted.dev' })
    await mw(ok, vi.fn(noop))
    expect(ok.getHeader('access-control-allow-origin')).toBe('https://app.trusted.dev')

    const bad = makeCtx('GET', { origin: 'https://app.untrusted.dev' })
    await mw(bad, vi.fn(noop))
    expect(bad.getHeader('access-control-allow-origin')).toBeUndefined()
  })

  it('credentials: true with concrete origin sets Allow-Credentials', async () => {
    const mw = corsMiddleware({ origin: 'https://app.com', credentials: true })
    const ctx = makeCtx('GET', { origin: 'https://app.com' })
    await mw(ctx, vi.fn(noop))
    expect(ctx.getHeader('access-control-allow-origin')).toBe('https://app.com')
    expect(ctx.getHeader('access-control-allow-credentials')).toBe('true')
  })

  it("credentials: true + origin: '*' throws at construction time", () => {
    expect(() => corsMiddleware({ origin: '*', credentials: true })).toThrow(
      /credentials.*incompatible.*\*/i,
    )
  })

  it('exposedHeaders: sets Access-Control-Expose-Headers on simple response', async () => {
    const mw = corsMiddleware({ exposedHeaders: ['x-trace-id'] })
    const ctx = makeCtx('GET', { origin: 'https://app.com' })
    const next = vi.fn(noop)
    await mw(ctx, next)
    expect(ctx.getHeader('access-control-expose-headers')).toBe('x-trace-id')
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('cors middleware — preflight', () => {
  it('OPTIONS + ACRM responds 204, reflects methods + headers, does NOT call next()', async () => {
    const mw = corsMiddleware()
    const ctx = makeCtx('OPTIONS', {
      origin: 'https://app.com',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'x-foo, x-bar',
    })
    const next = vi.fn(noop)
    await mw(ctx, next)

    expect(ctx._statusCode).toBe(204)
    expect(ctx._written).toBe(true)
    expect(next).not.toHaveBeenCalled()

    const allowMethods = ctx.getHeader('access-control-allow-methods')
    expect(allowMethods).toBe('GET,HEAD,PUT,PATCH,POST,DELETE')

    const allowHeaders = ctx.getHeader('access-control-allow-headers')
    expect(allowHeaders).toBe('x-foo, x-bar')
  })

  it('non-preflight OPTIONS (no ACRM) behaves as simple request — falls through', async () => {
    const mw = corsMiddleware()
    const ctx = makeCtx('OPTIONS', { origin: 'https://app.com' })
    const next = vi.fn(noop)
    await mw(ctx, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(ctx._written).toBe(false)
    expect(ctx.getHeader('access-control-allow-methods')).toBeUndefined()
    expect(ctx.getHeader('access-control-allow-origin')).toBe('*')
  })

  it('maxAge: sets Access-Control-Max-Age on preflight only', async () => {
    const mw = corsMiddleware({ maxAge: 3600 })

    // Preflight: header present.
    const pre = makeCtx('OPTIONS', {
      origin: 'https://app.com',
      'access-control-request-method': 'PUT',
    })
    await mw(pre, vi.fn(noop))
    expect(pre.getHeader('access-control-max-age')).toBe('3600')

    // Simple request: header absent.
    const simple = makeCtx('GET', { origin: 'https://app.com' })
    await mw(simple, vi.fn(noop))
    expect(simple.getHeader('access-control-max-age')).toBeUndefined()
  })

  it('allowedHeaders override: uses configured list, ignores ACRH (no Vary)', async () => {
    const mw = corsMiddleware({ allowedHeaders: ['x-only-this'] })
    const ctx = makeCtx('OPTIONS', {
      origin: 'https://app.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'x-foo',
    })
    await mw(ctx, vi.fn(noop))
    expect(ctx.getHeader('access-control-allow-headers')).toBe('x-only-this')
  })
})
