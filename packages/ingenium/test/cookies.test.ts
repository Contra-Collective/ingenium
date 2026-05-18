import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { IngeniumContext } from '../src/context/context.ts'
import { IngeniumError } from '../src/errors.ts'

/** Build a fresh context with the given Cookie header (or none). */
function ctxWithCookie(cookieHeader?: string): IngeniumContext {
  const c = new IngeniumContext()
  if (cookieHeader !== undefined) c.headers = { cookie: cookieHeader }
  return c
}

describe('ctx.cookies — lazy holder', () => {
  it('is null before first access (zero-overhead by default)', () => {
    const c = new IngeniumContext()
    expect(c._cookies).toBeNull()
  })

  it('allocates the holder on first access and caches it', () => {
    const c = ctxWithCookie('a=1')
    expect(c._cookies).toBeNull()
    const first = c.cookies
    expect(c._cookies).not.toBeNull()
    expect(c.cookies).toBe(first)
  })

  it('is reset to null when the context is recycled', () => {
    const c = ctxWithCookie('a=1')
    void c.cookies // force allocation
    expect(c._cookies).not.toBeNull()
    c.reset()
    expect(c._cookies).toBeNull()
  })
})

describe('ctx.cookies — read side', () => {
  it('get(name) returns the parsed value', () => {
    const c = ctxWithCookie('sid=abc; theme=dark')
    expect(c.cookies.get('sid')).toBe('abc')
    expect(c.cookies.get('theme')).toBe('dark')
  })

  it('get(missing) returns null', () => {
    const c = ctxWithCookie('a=1')
    expect(c.cookies.get('missing')).toBeNull()
  })

  it('get on empty / missing Cookie header returns null', () => {
    expect(new IngeniumContext().cookies.get('x')).toBeNull()
  })

  it('all() returns the full parsed record', () => {
    const c = ctxWithCookie('a=1; b=two; c=%E2%9C%93')
    const all = c.cookies.all()
    expect(all).toEqual({ a: '1', b: 'two', c: '✓' })
  })

  it('first occurrence wins on duplicate names', () => {
    const c = ctxWithCookie('a=1; a=2')
    expect(c.cookies.get('a')).toBe('1')
  })
})

describe('ctx.cookies — write side', () => {
  it('set(name, value) writes Set-Cookie with default Path=/', () => {
    const c = new IngeniumContext()
    c.cookies.set('name', 'value')
    expect(c.getHeader('set-cookie')).toBe('name=value; Path=/')
  })

  it('set encodes the value (semicolons cannot break the header)', () => {
    const c = new IngeniumContext()
    c.cookies.set('k', 'v=1; with spaces')
    const v = c.getHeader('set-cookie') as string
    expect(v).toContain('k=v%3D1%3B%20with%20spaces')
  })

  it('set with HttpOnly, Secure, SameSite=strict emits each flag', () => {
    const c = new IngeniumContext()
    c.cookies.set('s', 'x', { httpOnly: true, secure: true, sameSite: 'strict' })
    const v = c.getHeader('set-cookie') as string
    expect(v).toContain('HttpOnly')
    expect(v).toContain('Secure')
    expect(v).toContain('SameSite=Strict')
  })

  it('sameSite=true maps to SameSite=Strict (Express compat)', () => {
    const c = new IngeniumContext()
    c.cookies.set('s', 'x', { sameSite: true })
    expect(c.getHeader('set-cookie')).toContain('SameSite=Strict')
  })

  it('sameSite=false omits the attribute entirely', () => {
    const c = new IngeniumContext()
    c.cookies.set('s', 'x', { sameSite: false })
    expect(c.getHeader('set-cookie')).not.toContain('SameSite')
  })

  it('set emits Domain, Max-Age, Expires, Priority, Partitioned when provided', () => {
    const c = new IngeniumContext()
    c.cookies.set('s', 'x', {
      domain: 'example.com',
      maxAge: 60,
      expires: new Date('2030-01-01T00:00:00Z'),
      priority: 'high',
      partitioned: true,
    })
    const v = c.getHeader('set-cookie') as string
    expect(v).toContain('Domain=example.com')
    expect(v).toContain('Max-Age=60')
    expect(v).toContain('Expires=' + new Date('2030-01-01T00:00:00Z').toUTCString())
    expect(v).toContain('Priority=High')
    expect(v).toContain('Partitioned')
  })

  it('multiple set() calls accumulate into a Set-Cookie array', () => {
    const c = new IngeniumContext()
    c.cookies.set('a', '1')
    c.cookies.set('b', '2')
    const arr = c.getHeader('set-cookie')
    expect(Array.isArray(arr)).toBe(true)
    expect(arr).toHaveLength(2)
    expect((arr as string[])[0]).toContain('a=1')
    expect((arr as string[])[1]).toContain('b=2')
  })

  it('clear() writes Max-Age=0 plus an Expires in the past', () => {
    const c = new IngeniumContext()
    c.cookies.clear('legacy')
    const v = c.getHeader('set-cookie') as string
    expect(v).toContain('legacy=')
    expect(v).toContain('Max-Age=0')
    expect(v).toContain('Expires=' + new Date(0).toUTCString())
  })

  it('clear() mirrors domain/path so the browser matches the right cookie', () => {
    const c = new IngeniumContext()
    c.cookies.clear('sid', { domain: 'example.com', path: '/app' })
    const v = c.getHeader('set-cookie') as string
    expect(v).toContain('Domain=example.com')
    expect(v).toContain('Path=/app')
  })
})

describe('ctx.cookies — signed cookies', () => {
  it('set + get with { signed: true } round-trips the value', () => {
    const c = new IngeniumContext()
    c._cookieSecrets = ['secret-a']
    c.cookies.set('s', 'payload', { signed: true })
    // Wire format is `payload.<base64url signature>`.
    const wire = c.getHeader('set-cookie') as string
    const match = wire.match(/^s=([^;]+)/)
    expect(match).not.toBeNull()
    const value = decodeURIComponent(match![1]!)
    expect(value.startsWith('payload.')).toBe(true)

    // Simulate the client echoing the cookie back on the next request.
    const c2 = new IngeniumContext()
    c2.headers = { cookie: `s=${value}` }
    c2._cookieSecrets = ['secret-a']
    expect(c2.cookies.get('s', { signed: true })).toBe('payload')
  })

  it('tampered signed cookie returns null', () => {
    const c = new IngeniumContext()
    c._cookieSecrets = ['k']
    c.cookies.set('s', 'payload', { signed: true })
    const wire = decodeURIComponent((c.getHeader('set-cookie') as string).match(/^s=([^;]+)/)![1]!)

    // Flip the last char of the signature.
    const last = wire.slice(-1)
    const tampered = wire.slice(0, -1) + (last === 'A' ? 'B' : 'A')
    const c2 = new IngeniumContext()
    c2.headers = { cookie: `s=${tampered}` }
    c2._cookieSecrets = ['k']
    expect(c2.cookies.get('s', { signed: true })).toBeNull()
  })

  it('secret rotation: cookies signed with the old key still verify when listed second', () => {
    // Mint a cookie signed with the OLD secret.
    const oldSig = createHmac('sha256', 'old').update('val').digest('base64url')
    const wire = `val.${oldSig}`

    // New deploy: 'new' first (signs), 'old' kept for verify.
    const c = new IngeniumContext()
    c.headers = { cookie: `s=${wire}` }
    c._cookieSecrets = ['new', 'old']
    expect(c.cookies.get('s', { signed: true })).toBe('val')
  })

  it('signed get with no secrets configured throws COOKIE_SECRET_MISSING', () => {
    const c = ctxWithCookie('s=val.sig')
    expect(() => c.cookies.get('s', { signed: true })).toThrow(IngeniumError)
    try {
      c.cookies.get('s', { signed: true })
    } catch (err) {
      expect((err as IngeniumError).code).toBe('COOKIE_SECRET_MISSING')
      expect((err as IngeniumError).statusCode).toBe(500)
    }
  })

  it('signed set with no secrets configured throws COOKIE_SECRET_MISSING', () => {
    const c = new IngeniumContext()
    expect(() => c.cookies.set('s', 'v', { signed: true })).toThrow(IngeniumError)
    try {
      c.cookies.set('s', 'v', { signed: true })
    } catch (err) {
      expect((err as IngeniumError).code).toBe('COOKIE_SECRET_MISSING')
    }
  })

  it('all() exposes the raw value.signature payload for signed cookies', () => {
    const c = new IngeniumContext()
    const sig = createHmac('sha256', 'k').update('payload').digest('base64url')
    c.headers = { cookie: `s=payload.${sig}` }
    expect(c.cookies.all()['s']).toBe(`payload.${sig}`)
  })
})
