import { describe, it, expect } from 'vitest'
import { IngeniumContext } from '../src/context/context.ts'
import { IngeniumHeaderInjectionError } from '../src/errors.ts'

describe('header-injection guard — ctx.set / ctx.setHeader', () => {
  it('valid header passes', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.set('X-Foo', 'bar')).not.toThrow()
    expect(ctx.getHeader('x-foo')).toBe('bar')
  })

  it('rejects value containing CR (\\r)', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.set('X-Foo', 'value\rinjected')).toThrow(IngeniumHeaderInjectionError)
  })

  it('rejects value containing LF (\\n)', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.set('X-Foo', 'value\ninjected')).toThrow(IngeniumHeaderInjectionError)
  })

  it('rejects value containing CRLF (\\r\\n) — classic response-splitting payload', () => {
    const ctx = new IngeniumContext()
    expect(() =>
      ctx.set('X-Foo', 'value\r\nSet-Cookie: evil=1'),
    ).toThrow(IngeniumHeaderInjectionError)
  })

  it('rejects array value when one element contains CRLF', () => {
    const ctx = new IngeniumContext()
    expect(() =>
      ctx.set('X-Foo', ['safe-1', 'safe-2', 'bad\r\nSet-Cookie: evil=1']),
    ).toThrow(IngeniumHeaderInjectionError)
  })

  it('accepts an array of fully-safe values', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.set('X-Foo', ['a', 'b', 'c'])).not.toThrow()
    expect(ctx.getHeader('x-foo')).toEqual(['a', 'b', 'c'])
  })

  it('rejects header NAME containing CRLF (different message vs. value)', () => {
    const ctx = new IngeniumContext()
    let caught: unknown
    try {
      ctx.set('X-Foo\r\nEvil', 'bar')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IngeniumHeaderInjectionError)
    expect((caught as Error).message).toMatch(/Header name/i)
  })

  it('boundary: empty string value is fine', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.set('X-Foo', '')).not.toThrow()
    expect(ctx.getHeader('x-foo')).toBe('')
  })

  it('boundary: empty array is fine', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.set('X-Foo', [])).not.toThrow()
  })

  it('setHeader (Express alias) is also guarded', () => {
    const ctx = new IngeniumContext()
    expect(() => ctx.setHeader('X-Foo', 'bad\r\nevil')).toThrow(IngeniumHeaderInjectionError)
  })

  it('error has statusCode 500 and code HEADER_INJECTION', () => {
    const ctx = new IngeniumContext()
    let caught: IngeniumHeaderInjectionError | undefined
    try {
      ctx.set('X-Foo', 'x\r\ny')
    } catch (e) {
      caught = e as IngeniumHeaderInjectionError
    }
    expect(caught).toBeInstanceOf(IngeniumHeaderInjectionError)
    expect(caught?.statusCode).toBe(500)
    expect(caught?.code).toBe('HEADER_INJECTION')
  })
})
