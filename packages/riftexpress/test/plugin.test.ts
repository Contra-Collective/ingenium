import { describe, expect, it, vi } from 'vitest'
import { rex } from '../src/index.ts'
import { RexApp } from '../src/app.ts'
import { RexContext } from '../src/context/context.ts'
import { RexUnauthorizedError } from '../src/errors.ts'
import type { RexPlugin } from '../src/plugin/types.ts'

/** Helper: build a context primed for `app.handle()`. */
function makeCtx(method = 'GET', path = '/'): RexContext {
  const ctx = new RexContext()
  ctx.method = method as RexContext['method']
  ctx.path = path
  ctx.url = path
  return ctx
}

describe('plugin system — register', () => {
  it('plugin can register a route which is then reachable', async () => {
    const app = rex()
    const plugin: RexPlugin = (a) => {
      a.get('/from-plugin', (ctx) => ctx.json({ ok: true }))
    }
    await app.register(plugin)

    const ctx = makeCtx('GET', '/from-plugin')
    await app.handle(ctx)
    expect(ctx._statusCode).toBe(200)
    expect(ctx._body).toEqual({
      kind: 'string',
      data: JSON.stringify({ ok: true }),
    })
  })

  it('plugin with options receives them verbatim', async () => {
    const app = rex()
    const seen: { value?: string } = {}
    const plugin: RexPlugin<{ value: string }> = (a, opts) => {
      seen.value = opts.value
      a.get('/v', (ctx) => ctx.json({ v: opts.value }))
    }
    await app.register(plugin, { value: 'hello' })
    expect(seen.value).toBe('hello')

    const ctx = makeCtx('GET', '/v')
    await app.handle(ctx)
    expect(ctx._body).toEqual({
      kind: 'string',
      data: JSON.stringify({ v: 'hello' }),
    })
  })

  it('register() returns the app for chaining and is awaitable', async () => {
    const app = rex()
    const noop: RexPlugin = () => {}
    const result = await app.register(noop)
    expect(result).toBeInstanceOf(RexApp)
    expect(result).toBe(app)
  })

  it('async plugin is awaited before register resolves', async () => {
    const app = rex()
    let installed = false
    const plugin: RexPlugin = async (a) => {
      await new Promise<void>((r) => setTimeout(r, 5))
      a.get('/late', (ctx) => ctx.text('ok'))
      installed = true
    }
    await app.register(plugin)
    expect(installed).toBe(true)

    const ctx = makeCtx('GET', '/late')
    await app.handle(ctx)
    expect(ctx._statusCode).toBe(200)
  })
})

describe('plugin system — hooks', () => {
  it('onRequest fires before the handler', async () => {
    const app = rex()
    const order: string[] = []
    app.hooks.onRequest((ctx) => {
      order.push(`onRequest:${ctx.path}`)
    })
    app.get('/h', (ctx) => {
      order.push('handler')
      ctx.json({})
    })

    await app.handle(makeCtx('GET', '/h'))
    expect(order).toEqual(['onRequest:/h', 'handler'])
  })

  it('onResponse fires after the handler resolves', async () => {
    const app = rex()
    const order: string[] = []
    app.hooks.onResponse(() => {
      order.push('onResponse')
    })
    app.get('/h', async (ctx) => {
      await Promise.resolve()
      order.push('handler')
      ctx.json({})
    })

    await app.handle(makeCtx('GET', '/h'))
    expect(order).toEqual(['handler', 'onResponse'])
  })

  it('onError fires when handler throws AND error boundary still writes 5xx', async () => {
    const app = rex()
    const seen: unknown[] = []
    app.hooks.onError((err) => {
      seen.push(err)
    })
    app.get('/boom', () => {
      throw new Error('boom')
    })

    const ctx = makeCtx('GET', '/boom')
    await app.handle(ctx)

    expect(seen).toHaveLength(1)
    expect((seen[0] as Error).message).toBe('boom')
    // Default boundary still owns the response.
    expect(ctx._statusCode).toBe(500)
    expect(ctx._body).toEqual({
      kind: 'string',
      data: JSON.stringify({ error: 'boom', code: 'INTERNAL_ERROR' }),
    })
  })

  it('onError throwing does NOT mask the original error', async () => {
    const app = rex()
    app.hooks.onError(() => {
      throw new Error('observer failure')
    })
    app.get('/boom', () => {
      throw new Error('original')
    })

    const ctx = makeCtx('GET', '/boom')
    await app.handle(ctx)
    // Original error is still serialized by the boundary.
    expect(ctx._body).toEqual({
      kind: 'string',
      data: JSON.stringify({ error: 'original', code: 'INTERNAL_ERROR' }),
    })
  })

  it('onCompose fires once before composition', async () => {
    const app = rex()
    const calls: string[] = []
    app.hooks.onCompose(() => {
      calls.push('compose')
    })
    app.get('/x', (ctx) => ctx.text('ok'))

    await app.handle(makeCtx('GET', '/x'))
    await app.handle(makeCtx('GET', '/x'))
    expect(calls).toEqual(['compose'])
  })

  it('onRoute fires for each registered route during composition', async () => {
    const app = rex()
    const seen: string[] = []
    app.hooks.onRoute((reg) => {
      seen.push(`${reg.method} ${reg.path}`)
    })
    app.get('/a', (ctx) => ctx.text('a'))
    app.post('/b', (ctx) => ctx.text('b'))

    await app.handle(makeCtx('GET', '/a'))
    expect(seen.sort()).toEqual(['GET /a', 'POST /b'])
  })

  it('hooks run sequentially in registration order', async () => {
    const app = rex()
    const order: string[] = []
    app.hooks.onRequest(async () => {
      await Promise.resolve()
      order.push('first')
    })
    app.hooks.onRequest(async () => {
      await Promise.resolve()
      order.push('second')
    })
    app.get('/x', (ctx) => ctx.text('ok'))

    await app.handle(makeCtx('GET', '/x'))
    expect(order).toEqual(['first', 'second'])
  })
})

describe('plugin system — decorators', () => {
  it('decorate(): factory runs once on first access; cached thereafter', async () => {
    const app = rex()
    const factory = vi.fn((_ctx: RexContext) => ({ id: 7 }))
    app.decorate('user', factory)

    let captured: unknown
    app.get('/me', (ctx) => {
      // Two reads — second must use cached value.
      const a = (ctx as unknown as { user: { id: number } }).user
      const b = (ctx as unknown as { user: { id: number } }).user
      captured = { a, b, sameRef: a === b }
      ctx.json({})
    })

    await app.handle(makeCtx('GET', '/me'))
    expect(factory).toHaveBeenCalledTimes(1)
    expect(captured).toEqual({ a: { id: 7 }, b: { id: 7 }, sameRef: true })
  })

  it('decorate(): factory not called if property never read', async () => {
    const app = rex()
    const factory = vi.fn(() => 'never')
    app.decorate('ghost', factory)
    app.get('/x', (ctx) => ctx.text('ok'))

    await app.handle(makeCtx('GET', '/x'))
    expect(factory).not.toHaveBeenCalled()
  })

  it('decorateRequest(): value is set eagerly at request start', async () => {
    const app = rex()
    let observed: number | undefined
    app.decorateRequest('startedAt', () => 42)
    app.get('/t', (ctx) => {
      observed = (ctx as unknown as { startedAt: number }).startedAt
      ctx.json({})
    })

    await app.handle(makeCtx('GET', '/t'))
    expect(observed).toBe(42)
  })

  it('decorators are reapplied per request (no leakage between requests)', async () => {
    const app = rex()
    let counter = 0
    app.decorateRequest('n', () => ++counter)
    app.get('/n', (ctx) => {
      ctx.json({ n: (ctx as unknown as { n: number }).n })
    })

    const c1 = makeCtx('GET', '/n')
    const c2 = makeCtx('GET', '/n')
    await app.handle(c1)
    await app.handle(c2)
    expect(c1._body).toEqual({ kind: 'string', data: JSON.stringify({ n: 1 }) })
    expect(c2._body).toEqual({ kind: 'string', data: JSON.stringify({ n: 2 }) })
  })
})

describe('plugin system — end-to-end auth plugin', () => {
  interface User {
    id: string
    name: string
  }

  /**
   * Sample auth plugin: registers an onRequest hook that validates the
   * Authorization header, decorates ctx with a lazy `user`, and exposes a
   * `requireAuth()` decorator method that handlers can call.
   */
  const authPlugin: RexPlugin<{ token: string; user: User }> = (app, opts) => {
    app.hooks.onRequest((ctx) => {
      const header = ctx.headers.authorization
      if (header === `Bearer ${opts.token}`) {
        ctx.state.authValid = true
      } else {
        ctx.state.authValid = false
      }
    })

    app.decorate('user', (ctx) => {
      if (ctx.state.authValid !== true) return null
      return opts.user
    })

    app.decorate('requireAuth', (ctx) => () => {
      if (ctx.state.authValid !== true) {
        throw new RexUnauthorizedError()
      }
    })
  }

  it('end-to-end: protected route succeeds with valid token', async () => {
    const app = rex()
    await app.register(authPlugin, {
      token: 'secret',
      user: { id: 'u1', name: 'Ada' },
    })

    app.get('/me', (ctx) => {
      ;(ctx as unknown as { requireAuth: () => void }).requireAuth()
      const user = (ctx as unknown as { user: User }).user
      ctx.json({ user })
    })

    const ctx = makeCtx('GET', '/me')
    ctx.headers = { authorization: 'Bearer secret' }
    await app.handle(ctx)

    expect(ctx._statusCode).toBe(200)
    expect(ctx._body).toEqual({
      kind: 'string',
      data: JSON.stringify({ user: { id: 'u1', name: 'Ada' } }),
    })
  })

  it('end-to-end: protected route 401s without token (via error boundary)', async () => {
    const app = rex()
    await app.register(authPlugin, {
      token: 'secret',
      user: { id: 'u1', name: 'Ada' },
    })

    app.get('/me', (ctx) => {
      ;(ctx as unknown as { requireAuth: () => void }).requireAuth()
      ctx.json({})
    })

    const ctx = makeCtx('GET', '/me')
    // No authorization header.
    await app.handle(ctx)

    expect(ctx._statusCode).toBe(401)
    expect(ctx._body).toEqual({
      kind: 'string',
      data: JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }),
    })
  })
})
