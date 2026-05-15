import { describe, it, expect } from 'vitest'
import { RiftexContext } from '../src/context/context.ts'
import { RiftexValidationError } from '../src/errors.ts'

function ctxWithQuery(raw: string): RiftexContext {
  const ctx = new RiftexContext()
  ctx.rawQuery = raw
  return ctx
}

describe('ctx.query.parse(schema)', () => {
  it('passes shallow array-aware object to a plain { parse } schema', () => {
    const ctx = ctxWithQuery('id=42&tag=a&tag=b&active=true')
    const schema = {
      parse(input: unknown): { id: string; tag: string[]; active: string } {
        const i = input as Record<string, string | string[]>
        return {
          id: String(i.id),
          tag: Array.isArray(i.tag) ? i.tag : [String(i.tag)],
          active: String(i.active),
        }
      },
    }
    const out = ctx.query.parse(schema)
    expect(out).toEqual({ id: '42', tag: ['a', 'b'], active: 'true' })
  })

  it('single-occurrence key → string, repeated key → string[]', () => {
    const ctx = ctxWithQuery('single=one&multi=a&multi=b&multi=c')
    let received: unknown = null
    ctx.query.parse({
      parse(input: unknown): unknown {
        received = input
        return input
      },
    })
    expect(received).toEqual({ single: 'one', multi: ['a', 'b', 'c'] })
  })

  it('zod-like safeParse: success path returns parsed data', () => {
    const ctx = ctxWithQuery('n=7')
    const schema = {
      safeParse(input: unknown): { success: true; data: { n: number } } | { success: false; error: { issues: { path: ReadonlyArray<string | number>; message: string }[] } } {
        const i = input as Record<string, string>
        const n = Number(i.n)
        if (!Number.isFinite(n)) {
          return { success: false, error: { issues: [{ path: ['n'], message: 'not a number' }] } }
        }
        return { success: true, data: { n } }
      },
    }
    const out = ctx.query.parse(schema)
    expect(out).toEqual({ n: 7 })
  })

  it('zod-like safeParse: failure throws RiftexValidationError with field map', () => {
    const ctx = ctxWithQuery('n=notanumber')
    const schema = {
      safeParse(input: unknown): { success: true; data: { n: number } } | { success: false; error: { issues: { path: ReadonlyArray<string | number>; message: string }[] } } {
        const i = input as Record<string, string>
        const n = Number(i.n)
        return Number.isFinite(n)
          ? { success: true, data: { n } }
          : { success: false, error: { issues: [{ path: ['n'], message: 'not a number' }] } }
      },
    }
    expect(() => ctx.query.parse(schema)).toThrow(RiftexValidationError)
    try {
      ctx.query.parse(schema)
    } catch (err) {
      expect((err as RiftexValidationError).fields).toEqual({ n: 'not a number' })
    }
  })

  it('Standard Schema v1: success returns transformed value', () => {
    const ctx = ctxWithQuery('city=Tokyo')
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate(input: unknown): { value: { city: string } } {
          return { value: { city: (input as Record<string, string>).city } }
        },
      },
    }
    const out = ctx.query.parse(schema)
    expect(out).toEqual({ city: 'Tokyo' })
  })

  it('Standard Schema v1: issues throw RiftexValidationError with dot-joined paths', () => {
    const ctx = ctxWithQuery('a=1')
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate(_input: unknown): { issues: { path: (string | { key: string })[]; message: string }[] } {
          return {
            issues: [
              { path: ['user', 'email'], message: 'required' },
              { path: [{ key: 'a' }], message: 'bad' },
            ],
          }
        },
      },
    }
    expect(() => ctx.query.parse(schema)).toThrow(RiftexValidationError)
    try {
      ctx.query.parse(schema)
    } catch (err) {
      expect((err as RiftexValidationError).fields).toEqual({
        'user.email': 'required',
        a: 'bad',
      })
    }
  })

  it('async Standard Schema validators throw a clear error (not silently await)', () => {
    const ctx = ctxWithQuery('a=1')
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate(_input: unknown): Promise<{ value: unknown }> {
          return Promise.resolve({ value: {} })
        },
      },
    }
    expect(() => ctx.query.parse(schema)).toThrow(RiftexValidationError)
  })

  it('plain parse throwing → RiftexValidationError with the message in _', () => {
    const ctx = ctxWithQuery('a=1')
    expect(() =>
      ctx.query.parse({
        parse(): never {
          throw new Error('boom')
        },
      }),
    ).toThrow(RiftexValidationError)
  })

  it('ctx.query remains a real URLSearchParams (get/has/getAll still work)', () => {
    const ctx = ctxWithQuery('a=1&a=2&b=3')
    expect(ctx.query.get('a')).toBe('1')
    expect(ctx.query.getAll('a')).toEqual(['1', '2'])
    expect(ctx.query.has('b')).toBe(true)
    expect(ctx.query.has('c')).toBe(false)
  })

  it('query is reset between context reuses (pool safety)', () => {
    const ctx = new RiftexContext()
    ctx.rawQuery = 'a=1'
    expect(ctx.query.get('a')).toBe('1')
    ctx.reset()
    ctx.rawQuery = 'b=2'
    expect(ctx.query.get('a')).toBe(null)
    expect(ctx.query.get('b')).toBe('2')
  })
})
