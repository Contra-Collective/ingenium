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

describe('expressCompat — known-broken detection', () => {
  // We don't want to take real runtime deps on body-parser/multer/express-session/
  // compression in this unit suite (the e2e suite already covers their behavior).
  // The detection mechanism is purely `mw.name`, so we fabricate look-alike
  // functions whose `.name` matches what each package's factory produces.
  const named = <T extends (...a: never[]) => unknown>(name: string, fn: T): T => {
    Object.defineProperty(fn, 'name', { value: name, configurable: true })
    return fn
  }

  const fakeBodyParserJson = (): ((req: unknown, res: unknown, next: () => void) => void) =>
    named('jsonParser', (_req: unknown, _res: unknown, next: () => void): void => next())
  const fakeBodyParserUrlencoded = (): ((req: unknown, res: unknown, next: () => void) => void) =>
    named('urlencodedParser', (_req: unknown, _res: unknown, next: () => void): void => next())
  const fakeBodyParserText = (): ((req: unknown, res: unknown, next: () => void) => void) =>
    named('textParser', (_req: unknown, _res: unknown, next: () => void): void => next())
  const fakeBodyParserRaw = (): ((req: unknown, res: unknown, next: () => void) => void) =>
    named('rawParser', (_req: unknown, _res: unknown, next: () => void): void => next())
  const fakeMulter = (): ((req: unknown, res: unknown, next: () => void) => void) =>
    named('multerMiddleware', (_req: unknown, _res: unknown, next: () => void): void => next())
  const fakeSession = (): ((req: unknown, res: unknown, next: () => void) => void) =>
    named('session', (_req: unknown, _res: unknown, next: () => void): void => next())
  const fakeCompression = (): ((req: unknown, res: unknown, next: () => void) => void) =>
    named('compression', (_req: unknown, _res: unknown, next: () => void): void => next())

  it('throws on body-parser jsonParser with the native equivalent in the message', () => {
    expect(() => expressCompat(fakeBodyParserJson())).toThrow(TypeError)
    expect(() => expressCompat(fakeBodyParserJson())).toThrow(/await ctx\.body\.json\(\)/)
    expect(() => expressCompat(fakeBodyParserJson())).toThrow(/body-parser/)
  })

  it('throws on body-parser urlencoded/text/raw with their respective native equivalents', () => {
    expect(() => expressCompat(fakeBodyParserUrlencoded())).toThrow(/await ctx\.body\.urlencoded\(\)/)
    expect(() => expressCompat(fakeBodyParserText())).toThrow(/await ctx\.body\.text\(\)/)
    expect(() => expressCompat(fakeBodyParserRaw())).toThrow(/await ctx\.body\.buffer\(\)/)
  })

  it('throws on multer with the multipart native equivalent', () => {
    expect(() => expressCompat(fakeMulter())).toThrow(TypeError)
    expect(() => expressCompat(fakeMulter())).toThrow(/await ctx\.body\.multipart\(\)/)
    expect(() => expressCompat(fakeMulter())).toThrow(/multer/)
  })

  it('throws on express-session pointing at sessionMiddleware', () => {
    expect(() => expressCompat(fakeSession())).toThrow(TypeError)
    expect(() => expressCompat(fakeSession())).toThrow(/sessionMiddleware/)
    expect(() => expressCompat(fakeSession())).toThrow(/express-session/)
  })

  it('throws on compression pointing at the reverse proxy', () => {
    expect(() => expressCompat(fakeCompression())).toThrow(TypeError)
    expect(() => expressCompat(fakeCompression())).toThrow(/reverse proxy/)
  })

  it('does NOT throw on cors() (known-good middleware)', () => {
    expect(() => expressCompat(cors())).not.toThrow()
  })

  it('does NOT throw on a user middleware whose name does not match the broken list', () => {
    const unknownFn = (_req: unknown, _res: unknown, next: () => void): void => next()
    expect(() => expressCompat(unknownFn)).not.toThrow()
    // Anonymous arrow functions have a name like '' or the variable name, both fine.
    const anon = ((): ((req: unknown, res: unknown, next: () => void) => void) => {
      return (_req, _res, next): void => next()
    })()
    expect(() => expressCompat(anon)).not.toThrow()
  })

  it('does NOT throw a false positive on a user fn that happens to be named "json"', () => {
    // Only EXACT matches against the broken table count. `json` is not `jsonParser`.
    const json = named('json', (_req: unknown, _res: unknown, next: () => void): void => next())
    expect(() => expressCompat(json)).not.toThrow()
  })

  it('opt-out: { allowKnownBroken: true } emits a warning instead of throwing', () => {
    const warnings: { msg: string; name: string }[] = []
    const onWarn = (w: Error): void => {
      warnings.push({ msg: w.message, name: w.name })
    }
    process.on('warning', onWarn)
    try {
      expect(() => expressCompat(fakeBodyParserJson(), { allowKnownBroken: true })).not.toThrow()
      expect(() => expressCompat(fakeMulter(), { allowKnownBroken: true })).not.toThrow()
      expect(() => expressCompat(fakeSession(), { allowKnownBroken: true })).not.toThrow()
      expect(() => expressCompat(fakeCompression(), { allowKnownBroken: true })).not.toThrow()
    } finally {
      process.off('warning', onWarn)
    }
    // process.emitWarning fires asynchronously on nextTick; flush.
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        expect(warnings.length).toBeGreaterThanOrEqual(4)
        expect(warnings.every((w) => w.name === 'RiftexCompatKnownBroken')).toBe(true)
        expect(warnings.some((w) => /body-parser/.test(w.msg))).toBe(true)
        expect(warnings.some((w) => /multer/.test(w.msg))).toBe(true)
        expect(warnings.some((w) => /express-session/.test(w.msg))).toBe(true)
        expect(warnings.some((w) => /reverse proxy/.test(w.msg))).toBe(true)
        resolve()
      })
    })
  })

  it('opt-out: returns a working RiftexMiddleware (warning path does not short-circuit)', async () => {
    // Silence the warning for this test only.
    const swallow = (): void => {}
    process.on('warning', swallow)
    try {
      const wrapped = expressCompat(
        named('jsonParser', (_req: unknown, _res: unknown, next: (err?: unknown) => void): void => next()),
        { allowKnownBroken: true },
      )
      let downstreamRan = false
      const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
      await wrapped(ctx, async () => {
        downstreamRan = true
      })
      expect(downstreamRan).toBe(true)
    } finally {
      process.off('warning', swallow)
    }
  })
})

describe('expressCompat — res-shim monkey-patch traps', () => {
  // These traps catch anonymous/wrapped versions of compression/express-session
  // that slip past the name-based detection. They fire at REQUEST time when the
  // wrapped middleware actually tries to monkey-patch res.write/res.end/res.pipe.

  it('throws when a middleware assigns res.write (the compression pattern)', async () => {
    const patcher = (_req: unknown, res: { write: unknown }, _next: () => void): void => {
      res.write = (): void => {}
    }
    const wrapped = expressCompat(patcher)
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await expect(wrapped(ctx, noopNext)).rejects.toThrow(/monkey-patch.*res\.write/)
  })

  it('throws when a middleware assigns res.end', async () => {
    const patcher = (_req: unknown, res: { end: unknown }, _next: () => void): void => {
      res.end = (): void => {}
    }
    const wrapped = expressCompat(patcher)
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await expect(wrapped(ctx, noopNext)).rejects.toThrow(/monkey-patch.*res\.end/)
  })

  it('throws when a middleware assigns res.pipe', async () => {
    const patcher = (_req: unknown, res: { pipe: unknown }, _next: () => void): void => {
      res.pipe = (): void => {}
    }
    const wrapped = expressCompat(patcher)
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await expect(wrapped(ctx, noopNext)).rejects.toThrow(/monkey-patch.*res\.pipe/)
  })

  it('reading res.write returns undefined (feature-detection still works)', async () => {
    let observed: unknown = 'not-set'
    const reader = (_req: unknown, res: { write: unknown }, next: () => void): void => {
      observed = res.write
      next()
    }
    const wrapped = expressCompat(reader)
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await wrapped(ctx, noopNext)
    expect(observed).toBeUndefined()
  })

  it('reading res.end returns the existing method (call site still works)', async () => {
    let observed: unknown = null
    const caller = (_req: unknown, res: { end: (chunk?: string) => unknown }, _next: () => void): void => {
      observed = typeof res.end
      res.end('ok')
    }
    const wrapped = expressCompat(caller)
    const ctx = makeCtx({ method: 'GET', url: '/x', path: '/x' })
    await wrapped(ctx, noopNext)
    expect(observed).toBe('function')
    expect(ctx._written).toBe(true)
  })
})
