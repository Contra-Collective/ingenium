import { describe, it, expect, vi } from 'vitest'
import { RiftexContext } from '../src/context/context.ts'
import {
  RiftexNotFoundError,
  RiftexValidationError,
  RiftexMethodNotAllowedError,
} from '../src/errors.ts'
import { problemDetailsMiddleware } from '../src/problem/middleware.ts'
import type { HttpMethod } from '../src/router/types.ts'

function makeCtx(overrides: Partial<{ method: HttpMethod; path: string }> = {}): RiftexContext {
  const ctx = new RiftexContext()
  ctx.method = (overrides.method ?? 'GET') as HttpMethod
  ctx.path = overrides.path ?? '/account/12345/msgs/abc'
  ctx.url = ctx.path
  return ctx
}

function readJsonBody(ctx: RiftexContext): unknown {
  const body = ctx._body
  if (body.kind !== 'string') throw new Error(`expected string body, got ${body.kind}`)
  return JSON.parse(body.data)
}

describe('problemDetails — RiftexError serialization', () => {
  it('serializes RiftexNotFoundError as a 404 Problem+JSON', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx({ method: 'GET', path: '/missing' })

    await mw(ctx, async () => { throw new RiftexNotFoundError('Item gone') })

    expect(ctx._statusCode).toBe(404)
    expect(ctx._written).toBe(true)
    expect(ctx.getHeader('content-type')).toBe('application/problem+json; charset=utf-8')

    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(problem.type).toBe('about:blank')
    expect(problem.title).toBe('Not Found')
    expect(problem.status).toBe(404)
    expect(problem.detail).toBe('Item gone')
    expect(problem.instance).toBe('/missing')
    expect(problem.code).toBe('NOT_FOUND')
  })

  it('typeBaseUrl shapes the type field with kebab-case slug', async () => {
    const mw = problemDetailsMiddleware({ typeBaseUrl: 'https://api.example.com/errors/' })
    const ctx = makeCtx()
    await mw(ctx, async () => { throw new RiftexNotFoundError() })
    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(problem.type).toBe('https://api.example.com/errors/not-found')
  })

  it('typeBaseUrl works without trailing slash', async () => {
    const mw = problemDetailsMiddleware({ typeBaseUrl: 'https://api.example.com/errors' })
    const ctx = makeCtx()
    await mw(ctx, async () => { throw new RiftexValidationError({ email: 'invalid' }) })
    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(problem.type).toBe('https://api.example.com/errors/validation-failed')
  })

  it('includeStack adds the stack as an extension member', async () => {
    const mw = problemDetailsMiddleware({ includeStack: true })
    const ctx = makeCtx()
    await mw(ctx, async () => { throw new RiftexNotFoundError() })
    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(typeof problem.stack).toBe('string')
    expect((problem.stack as string).length).toBeGreaterThan(0)
  })

  it('omits stack by default', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx()
    await mw(ctx, async () => { throw new RiftexNotFoundError() })
    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect('stack' in problem).toBe(false)
  })

  it('RiftexValidationError includes fields extension', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx({ method: 'POST', path: '/users' })
    await mw(ctx, async () => {
      throw new RiftexValidationError({ email: 'must be a valid email', age: 'must be >= 18' })
    })

    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(problem.status).toBe(422)
    expect(problem.title).toBe('Validation Failed')
    expect(problem.fields).toEqual({ email: 'must be a valid email', age: 'must be >= 18' })
  })

  it('RiftexMethodNotAllowedError includes allowed array AND sets Allow header', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx({ method: 'DELETE', path: '/users/42' })
    await mw(ctx, async () => {
      throw new RiftexMethodNotAllowedError(['GET', 'POST'])
    })

    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(problem.status).toBe(405)
    expect(problem.allowed).toEqual(['GET', 'POST'])
    expect(ctx.getHeader('allow')).toBe('GET, POST')
  })

  it('unknown error → 500 with type about:blank and generic title', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx()
    await mw(ctx, async () => { throw new Error('boom internals') })

    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(problem.status).toBe(500)
    expect(problem.type).toBe('about:blank')
    expect(problem.title).toBe('Internal Server Error')
    expect(problem.detail).toBe('boom internals')
    expect(ctx._statusCode).toBe(500)
  })

  it('content-type is exactly application/problem+json', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx()
    await mw(ctx, async () => { throw new RiftexNotFoundError() })
    expect(ctx.getHeader('content-type')).toBe('application/problem+json; charset=utf-8')
  })

  it('uses custom instance callback', async () => {
    const instance = vi.fn((ctx: RiftexContext) => `urn:request:${ctx.method}:${ctx.path}`)
    const mw = problemDetailsMiddleware({ instance })
    const ctx = makeCtx({ method: 'POST', path: '/widgets' })
    await mw(ctx, async () => { throw new RiftexNotFoundError() })

    const problem = readJsonBody(ctx) as Record<string, unknown>
    expect(instance).toHaveBeenCalledTimes(1)
    expect(problem.instance).toBe('urn:request:POST:/widgets')
  })

  it('passes through when downstream succeeds without throwing', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx()
    await mw(ctx, async () => { ctx.json({ ok: true }) })

    expect(ctx._statusCode).toBe(200)
    expect(ctx.getHeader('content-type')).toBe('application/json; charset=utf-8')
  })

  it('does not clobber an already-written response when handler throws', async () => {
    const mw = problemDetailsMiddleware()
    const ctx = makeCtx()
    await expect(
      mw(ctx, async () => {
        ctx.json({ partial: true }, 201)
        throw new Error('after-write')
      }),
    ).rejects.toThrow('after-write')

    expect(ctx._statusCode).toBe(201)
  })
})
