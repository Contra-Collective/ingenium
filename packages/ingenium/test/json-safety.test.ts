import { describe, it, expect } from 'vitest'
import { IngeniumContext } from '../src/context/context.ts'
import { IngeniumUnserializableError, IngeniumError } from '../src/errors.ts'
import { safeJsonStringify } from '../src/util/safe-json.ts'
import { respondJsonWithEtag } from '../src/negotiation/json-etag.ts'

describe('ctx.json — strict serialization safety', () => {
  it('plain object serializes normally', () => {
    const ctx = new IngeniumContext()
    ctx.json({ ok: true })
    expect(ctx._statusCode).toBe(200)
    const body = ctx._body
    expect(body.kind).toBe('string')
    if (body.kind === 'string') {
      expect(JSON.parse(body.data)).toEqual({ ok: true })
    }
  })

  it('circular reference throws IngeniumUnserializableError mentioning "circular"', () => {
    const ctx = new IngeniumContext()
    type Node = { self: Node | null }
    const a: Node = { self: null }
    a.self = a

    let caught: unknown
    try {
      ctx.json(a)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IngeniumUnserializableError)
    expect((caught as Error).message).toMatch(/circular/i)
    expect((caught as IngeniumUnserializableError).statusCode).toBe(500)
    expect((caught as IngeniumUnserializableError).code).toBe('UNSERIALIZABLE_RESPONSE')
  })

  it('BigInt throws IngeniumUnserializableError mentioning "BigInt"', () => {
    const ctx = new IngeniumContext()
    let caught: unknown
    try {
      ctx.json({ x: 1n })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IngeniumUnserializableError)
    expect((caught as Error).message).toMatch(/BigInt/i)
  })

  it('does not partially mutate ctx state when stringify fails (status not bumped before throw)', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.json({ x: 1n }, 201)).toThrow(IngeniumUnserializableError)
    expect(ctx._statusCode).toBe(200)
    expect(ctx._written).toBe(false)
  })

  it('the thrown error is a IngeniumError subclass — caught by the framework error boundary', () => {
    const ctx = new IngeniumContext()
    let caught: unknown
    try {
      ctx.json({ x: 1n })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IngeniumError)
    // The error itself is a tiny shape — serializable, no infinite loop.
    expect(() => JSON.stringify({
      statusCode: (caught as IngeniumError).statusCode,
      code: (caught as IngeniumError).code,
      message: (caught as Error).message,
    })).not.toThrow()
  })
})

describe('respondJsonWithEtag — strict serialization safety', () => {
  it('circular throws IngeniumUnserializableError', () => {
    const ctx = new IngeniumContext()
    type Node = { self: Node | null }
    const a: Node = { self: null }
    a.self = a
    expect(() => respondJsonWithEtag(ctx, a)).toThrow(IngeniumUnserializableError)
  })

  it('BigInt throws IngeniumUnserializableError', () => {
    const ctx = new IngeniumContext()
    expect(() => respondJsonWithEtag(ctx, { x: 1n })).toThrow(IngeniumUnserializableError)
  })
})

describe('safeJsonStringify — lenient opt-in helper', () => {
  it('plain values match JSON.stringify', () => {
    expect(safeJsonStringify({ a: 1, b: 'x' })).toBe(JSON.stringify({ a: 1, b: 'x' }))
  })

  it('circular references are emitted as "[Circular]" markers', () => {
    type Node = { name: string; child: Node | null }
    const a: Node = { name: 'root', child: null }
    a.child = a
    const out = safeJsonStringify(a)
    expect(out).toContain('[Circular]')
    expect(() => JSON.parse(out)).not.toThrow()
  })

  it('BigInt is emitted as a JSON string preserving precision', () => {
    // Documented behavior: BigInt → JSON string, e.g. 1n → "1".
    const out = safeJsonStringify({ big: 9007199254740993n })
    expect(out).toBe('{"big":"9007199254740993"}')
  })

  it('symbols and functions are dropped (matches JSON.stringify default)', () => {
    const out = safeJsonStringify({ s: Symbol('x'), f: () => 1, n: 42 })
    expect(JSON.parse(out)).toEqual({ n: 42 })
  })

  it('honors a user-supplied replacer after sanitization', () => {
    const out = safeJsonStringify({ a: 1, secret: 'hunter2' }, {
      replacer: (key, value) => (key === 'secret' ? '[redacted]' : value),
    })
    expect(JSON.parse(out)).toEqual({ a: 1, secret: '[redacted]' })
  })

  it('honors `space` for pretty-printing', () => {
    const out = safeJsonStringify({ a: 1 }, { space: 2 })
    expect(out).toContain('\n')
  })
})
