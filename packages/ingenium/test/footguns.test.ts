import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ingenium } from '../src/index.ts'
import {
  IngeniumContext,
  _resetFootgunWarnings,
} from '../src/context/context.ts'
import {
  reflectReturn,
  _resetReflectFootgunWarnings,
} from '../src/response/reflect.ts'
import type { ListeningServer } from '../src/transport/types.ts'

// ───────────────────────────────────────────────────────────────────────────
// F1 — Double response write
// ───────────────────────────────────────────────────────────────────────────

describe('F1: double response write emits IngeniumDoubleWriteWarning', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('warns when ctx.json() is called twice', () => {
    const ctx = new IngeniumContext()
    ctx.json({ ok: true })
    ctx.json({ err: 'oops' })

    const matched = warn.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('ctx.json()') &&
        (call[0] as string).includes('already written'),
    )
    expect(matched).toBeDefined()
    expect(matched?.[1]).toMatchObject({ type: 'IngeniumDoubleWriteWarning' })
  })

  it('does NOT warn on the first write', () => {
    const ctx = new IngeniumContext()
    ctx.json({ ok: true })
    const matched = warn.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && (call[0] as string).includes('IngeniumDoubleWriteWarning'),
    )
    // First write should not produce the double-write warning (matched by type
    // in options bag — we check the call's options instead).
    const doubleWriteCalls = warn.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumDoubleWriteWarning',
    )
    expect(doubleWriteCalls).toHaveLength(0)
    // ensure we didn't reference `matched` to silence eslint
    void matched
  })

  it('warns when mixing writer methods (text after json)', () => {
    const ctx = new IngeniumContext()
    ctx.json({ ok: true })
    ctx.text('overwrite')

    const matched = warn.mock.calls.find(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumDoubleWriteWarning' &&
        typeof call[0] === 'string' &&
        (call[0] as string).includes('ctx.text()'),
    )
    expect(matched).toBeDefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// F2 — Reading ctx.ip with trustProxy: false but XFF present
// ───────────────────────────────────────────────────────────────────────────

describe('F2: ctx.ip with trustProxy disabled + XFF present', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetFootgunWarnings()
    warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    _resetFootgunWarnings()
  })

  it('emits IngeniumTrustProxyWarning once when reading ctx.ip', () => {
    const ctx = new IngeniumContext()
    ctx.headers = { 'x-forwarded-for': '1.2.3.4' }
    ctx.remoteAddress = '10.0.0.5'
    // trustProxy is false by default — read ctx.ip to trigger the check.
    void ctx.ip

    const matched = warn.mock.calls.find(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumTrustProxyWarning',
    )
    expect(matched).toBeDefined()
    expect(matched?.[0]).toMatch(/trustProxy/i)
    expect(matched?.[0]).toMatch(/X-Forwarded-For/)
  })

  it('does NOT warn when no XFF header is present', () => {
    const ctx = new IngeniumContext()
    ctx.headers = {}
    ctx.remoteAddress = '10.0.0.5'
    void ctx.ip

    const trustWarnings = warn.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumTrustProxyWarning',
    )
    expect(trustWarnings).toHaveLength(0)
  })

  it('only warns once per process (subsequent reads stay silent)', () => {
    const ctx1 = new IngeniumContext()
    ctx1.headers = { 'x-forwarded-for': '1.2.3.4' }
    void ctx1.ip
    void ctx1.ip
    const ctx2 = new IngeniumContext()
    ctx2.headers = { 'x-forwarded-for': '5.6.7.8' }
    void ctx2.ip

    const trustWarnings = warn.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumTrustProxyWarning',
    )
    expect(trustWarnings).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// F5 — app.listen() called twice on the same app
// ───────────────────────────────────────────────────────────────────────────

describe('F5: app.listen() called twice throws', () => {
  let server: ListeningServer | null = null

  afterEach(async () => {
    if (server) {
      await server.close()
      server = null
    }
  })

  it('throws a clear TypeError on the second listen()', async () => {
    const app = ingenium()
    app.get('/', () => 'ok')
    server = await app.listen(0, '127.0.0.1')

    await expect(app.listen(0, '127.0.0.1')).rejects.toThrow(/already listening/)
  })

  it('allows listen() again after close()', async () => {
    const app = ingenium()
    app.get('/', () => 'ok')
    const s1 = await app.listen(0, '127.0.0.1')
    await s1.close()
    // Re-listen should work without throwing.
    server = await app.listen(0, '127.0.0.1')
    expect(typeof server.port).toBe('number')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// F6 — Returning a fetch `Response` object from a handler
// ───────────────────────────────────────────────────────────────────────────

describe('F6: handler returning a fetch Response object', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetReflectFootgunWarnings()
    warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    _resetReflectFootgunWarnings()
  })

  it('emits IngeniumResponseObjectWarning and falls through to 204', () => {
    // Skip if the global Response isn't available in this runtime.
    if (typeof Response === 'undefined') return

    const ctx = new IngeniumContext()
    reflectReturn(ctx, new Response('hi'))

    const matched = warn.mock.calls.find(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumResponseObjectWarning',
    )
    expect(matched).toBeDefined()
    expect(matched?.[0]).toMatch(/fetch-style Response/)
    // Fallthrough: status 204, body remains 'none' (NOT JSON-serialized).
    expect(ctx._statusCode).toBe(204)
    expect(ctx._body).toEqual({ kind: 'none' })
  })

  it('only warns once per process', () => {
    if (typeof Response === 'undefined') return
    const a = new IngeniumContext()
    reflectReturn(a, new Response('a'))
    const b = new IngeniumContext()
    reflectReturn(b, new Response('b'))

    const responseObjectWarnings = warn.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumResponseObjectWarning',
    )
    expect(responseObjectWarnings).toHaveLength(1)
  })

  it('does not affect normal return values', () => {
    const ctx = new IngeniumContext()
    reflectReturn(ctx, { ok: true })
    expect(ctx._statusCode).toBe(200)
    expect(ctx._body).toEqual({ kind: 'string', data: JSON.stringify({ ok: true }) })

    const responseObjectWarnings = warn.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        (call[1] as { type?: string }).type === 'IngeniumResponseObjectWarning',
    )
    expect(responseObjectWarnings).toHaveLength(0)
  })
})
