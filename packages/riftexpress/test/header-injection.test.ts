import { describe, it, expect } from 'vitest'
import { RiftexContext } from '../src/context/context.ts'
import { RiftexHeaderInjectionError } from '../src/errors.ts'

describe('header-injection guard — ctx.set / ctx.setHeader', () => {
  it('valid header passes', () => {
    const ctx = new RiftexContext()
    expect(() => ctx.set('X-Foo', 'bar')).not.toThrow()
    expect(ctx.getHeader('x-foo')).toBe('bar')
  })

  it('rejects value containing CR (\\r)', () => {
    const ctx = new RiftexContext()
    expect(() => ctx.set('X-Foo', 'value\rinjected')).toThrow(RiftexHeaderInjectionError)
  })

  it('rejects value containing LF (\\n)', () => {
    const ctx = new RiftexContext()
    expect(() => ctx.set('X-Foo', 'value\ninjected')).toThrow(RiftexHeaderInjectionError)
  })

  it('rejects value containing CRLF (\\r\\n) — classic response-splitting payload', () => {
    const ctx = new RiftexContext()
    expect(() =>
      ctx.set('X-Foo', 'value\r\nSet-Cookie: evil=1'),
    ).toThrow(RiftexHeaderInjectionError)
  })

  it('rejects array value when one element contains CRLF', () => {
    const ctx = new RiftexContext()
    expect(() =>
      ctx.set('X-Foo', ['safe-1', 'safe-2', 'bad\r\nSet-Cookie: evil=1']),
    ).toThrow(RiftexHeaderInjectionError)
  })

  it('accepts an array of fully-safe values', () => {
    const ctx = new RiftexContext()
    expect(() => ctx.set('X-Foo', ['a', 'b', 'c'])).not.toThrow()
    expect(ctx.getHeader('x-foo')).toEqual(['a', 'b', 'c'])
  })

  it('rejects header NAME containing CRLF (different message vs. value)', () => {
    const ctx = new RiftexContext()
    let caught: unknown
    try {
      ctx.set('X-Foo\r\nEvil', 'bar')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(RiftexHeaderInjectionError)
    expect((caught as Error).message).toMatch(/Header name/i)
  })

  it('boundary: empty string value is fine', () => {
    const ctx = new RiftexContext()
    expect(() => ctx.set('X-Foo', '')).not.toThrow()
    expect(ctx.getHeader('x-foo')).toBe('')
  })

  it('boundary: empty array is fine', () => {
    const ctx = new RiftexContext()
    expect(() => ctx.set('X-Foo', [])).not.toThrow()
  })

  it('setHeader (Express alias) is also guarded', () => {
    const ctx = new RiftexContext()
    expect(() => ctx.setHeader('X-Foo', 'bad\r\nevil')).toThrow(RiftexHeaderInjectionError)
  })

  it('error has statusCode 500 and code HEADER_INJECTION', () => {
    const ctx = new RiftexContext()
    let caught: RiftexHeaderInjectionError | undefined
    try {
      ctx.set('X-Foo', 'x\r\ny')
    } catch (e) {
      caught = e as RiftexHeaderInjectionError
    }
    expect(caught).toBeInstanceOf(RiftexHeaderInjectionError)
    expect(caught?.statusCode).toBe(500)
    expect(caught?.code).toBe('HEADER_INJECTION')
  })
})
