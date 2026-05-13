import { describe, it, expect } from 'vitest'
import type { IncomingHttpHeaders } from 'node:http'
import { Buffer } from 'node:buffer'

import {
  parseAcceptHeader,
  selectBest,
  expandShorthand,
  sortByPreference,
} from '../src/negotiation/accept.ts'
import {
  accepts,
  acceptsCharsets,
  acceptsLanguages,
  acceptsEncodings,
  type NegotiableCtx,
} from '../src/negotiation/negotiate.ts'
import { formatResponse, type FormattableCtx } from '../src/negotiation/format.ts'
import { isFresh } from '../src/negotiation/fresh.ts'
import { computeEtag } from '../src/negotiation/etag.ts'
import { respondJsonWithEtag, type JsonEtagCtx } from '../src/negotiation/json-etag.ts'
import { RiftexError } from '../src/errors.ts'

// ────────────────────── helpers ───────────────────────

function makeCtx(headers: IncomingHttpHeaders = {}): NegotiableCtx {
  return { headers }
}

function makeFormatCtx(headers: IncomingHttpHeaders = {}): FormattableCtx & {
  _ct?: string
  _written?: { kind: string; data?: unknown }
} {
  const c: FormattableCtx & { _ct?: string; _written?: { kind: string; data?: unknown } } = {
    headers,
    set(name: string, value: string | string[]) {
      if (name.toLowerCase() === 'content-type') c._ct = String(value)
      return c
    },
    json(body: unknown) {
      c._written = { kind: 'json', data: body }
    },
    send(body: Buffer | string) {
      c._written = { kind: 'send', data: body }
    },
  }
  return c
}

function makeJsonEtagCtx(headers: IncomingHttpHeaders = {}): JsonEtagCtx {
  return {
    headers,
    _statusCode: 200,
    _headers: Object.create(null) as Record<string, string | string[]>,
    _body: { kind: 'none' },
    _written: false,
  }
}

// ────────────────────── parseAcceptHeader ───────────────────────

describe('parseAcceptHeader', () => {
  it('returns [] for undefined / empty', () => {
    expect(parseAcceptHeader(undefined)).toEqual([])
    expect(parseAcceptHeader('')).toEqual([])
  })

  it('parses a single bare type', () => {
    const r = parseAcceptHeader('text/html')
    expect(r).toEqual([{ type: 'text/html', quality: 1, params: {} }])
  })

  it('parses multiple types with q-values', () => {
    const r = parseAcceptHeader('text/html;q=0.9, application/json')
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ type: 'text/html', quality: 0.9, params: {} })
    expect(r[1]).toEqual({ type: 'application/json', quality: 1, params: {} })
  })

  it('clamps malformed q-values to 0', () => {
    const r = parseAcceptHeader('text/plain;q=abc')
    expect(r[0]?.quality).toBe(0)
  })

  it('preserves non-q params', () => {
    const r = parseAcceptHeader('text/html;level=1;q=0.8')
    expect(r[0]).toEqual({ type: 'text/html', quality: 0.8, params: { level: '1' } })
  })

  it('drops empty segments leniently', () => {
    const r = parseAcceptHeader('text/html, , application/json')
    expect(r).toHaveLength(2)
  })
})

// ────────────────────── sortByPreference ───────────────────────

describe('sortByPreference', () => {
  it('sorts by q descending then specificity descending', () => {
    const r = sortByPreference(parseAcceptHeader('*/*;q=0.1, text/*, text/html, application/json;q=0.9'))
    // Spec: q desc first, then specificity desc as tiebreaker. text/* (q=1)
    // outranks application/json (q=0.9) on quality alone; specificity only
    // disambiguates within the same q-tier.
    expect(r.map((e) => e.type)).toEqual(['text/html', 'text/*', 'application/json', '*/*'])
  })
})

// ────────────────────── selectBest ───────────────────────

describe('selectBest', () => {
  it('returns first offered when no Accept header present', () => {
    expect(selectBest(undefined, ['application/json', 'text/html'])).toBe('application/json')
    expect(selectBest('', ['application/json'])).toBe('application/json')
  })

  it('matches exact mime', () => {
    expect(selectBest('application/json', ['application/json', 'text/html'])).toBe('application/json')
  })

  it('matches type wildcard', () => {
    expect(selectBest('text/*', ['application/json', 'text/html'])).toBe('text/html')
  })

  it('matches global wildcard', () => {
    expect(selectBest('*/*', ['text/csv'])).toBe('text/csv')
  })

  it('honors q-value tiebreaker — higher q wins', () => {
    expect(
      selectBest('text/html;q=0.5, application/json;q=0.9', ['text/html', 'application/json']),
    ).toBe('application/json')
  })

  it('q=0 rejects a type entirely', () => {
    expect(selectBest('text/html;q=0, */*', ['text/html'])).toBe('text/html')
    // ^ falls through wildcard since q=0 entry is skipped but */* still matches.
    expect(selectBest('text/html;q=0', ['text/html'])).toBe(false)
  })

  it('returns false when nothing matches', () => {
    expect(selectBest('image/png', ['application/json'])).toBe(false)
  })

  it('returns false when offered list is empty', () => {
    expect(selectBest('*/*', [])).toBe(false)
  })

  it('prefers more specific match over wildcard', () => {
    // Both `text/html` and `*/*` match an HTML offer; `text/html` is more specific.
    expect(selectBest('*/*, text/html', ['application/json', 'text/html'])).toBe('text/html')
  })
})

// ────────────────────── shorthand expansion ───────────────────────

describe('expandShorthand', () => {
  it('expands well-known shorthands', () => {
    expect(expandShorthand('json')).toBe('application/json')
    expect(expandShorthand('html')).toBe('text/html')
    expect(expandShorthand('csv')).toBe('text/csv')
  })

  it('passes through full mimes unchanged', () => {
    expect(expandShorthand('application/xml')).toBe('application/xml')
  })
})

// ────────────────────── accepts(ctx, ...) ───────────────────────

describe('accepts', () => {
  it('returns the parsed list when called with no types', () => {
    const ctx = makeCtx({ accept: 'text/html, application/json;q=0.9' })
    expect(accepts(ctx)).toEqual(['text/html', 'application/json'])
  })

  it('matches shorthand and full mime equivalently', () => {
    const ctx = makeCtx({ accept: 'application/json' })
    expect(accepts(ctx, 'json', 'html')).toBe('json')
    expect(accepts(ctx, 'application/json', 'text/html')).toBe('application/json')
  })

  it('returns false on no match', () => {
    const ctx = makeCtx({ accept: 'image/png' })
    expect(accepts(ctx, 'json', 'html')).toBe(false)
  })

  it('returns first offered when no Accept header', () => {
    const ctx = makeCtx({})
    expect(accepts(ctx, 'json', 'html')).toBe('json')
  })
})

// ────────────────────── acceptsLanguages / Charsets / Encodings ───────────────────────

describe('acceptsLanguages', () => {
  it('selects best language by q', () => {
    const ctx = makeCtx({ 'accept-language': 'en;q=0.5, fr;q=0.9' })
    expect(acceptsLanguages(ctx, 'en', 'fr')).toBe('fr')
  })

  it('returns false when none offered match', () => {
    const ctx = makeCtx({ 'accept-language': 'de' })
    expect(acceptsLanguages(ctx, 'en', 'fr')).toBe(false)
  })
})

describe('acceptsCharsets', () => {
  it('selects best charset', () => {
    const ctx = makeCtx({ 'accept-charset': 'utf-8, iso-8859-1;q=0.5' })
    expect(acceptsCharsets(ctx, 'iso-8859-1', 'utf-8')).toBe('utf-8')
  })
})

describe('acceptsEncodings', () => {
  it('selects best encoding via wildcard', () => {
    const ctx = makeCtx({ 'accept-encoding': 'gzip, *;q=0.1' })
    expect(acceptsEncodings(ctx, 'br', 'gzip')).toBe('gzip')
  })

  it('falls back to first when header absent', () => {
    const ctx = makeCtx({})
    expect(acceptsEncodings(ctx, 'gzip', 'br')).toBe('gzip')
  })
})

// ────────────────────── formatResponse ───────────────────────

describe('formatResponse', () => {
  it('picks the right handler and sets content-type', async () => {
    const ctx = makeFormatCtx({ accept: 'application/json' })
    await formatResponse(ctx, {
      'application/json': () => ({ ok: true }),
      'text/csv': () => 'a,b\n1,2',
    })
    expect(ctx._ct).toBe('application/json')
    expect(ctx._written).toEqual({ kind: 'json', data: { ok: true } })
  })

  it('runs async handlers', async () => {
    const ctx = makeFormatCtx({ accept: 'text/csv' })
    await formatResponse(ctx, {
      'application/json': () => ({}),
      'text/csv': async () => 'x,y\n1,2',
    })
    expect(ctx._ct).toBe('text/csv')
    expect(ctx._written).toEqual({ kind: 'send', data: 'x,y\n1,2' })
  })

  it('falls back to default when no key matches', async () => {
    const ctx = makeFormatCtx({ accept: 'image/png' })
    await formatResponse(ctx, {
      'application/json': () => ({ ok: true }),
      default: () => 'fallback',
    })
    expect(ctx._written).toEqual({ kind: 'send', data: 'fallback' })
  })

  it('throws RiftexError(406) when no match and no default', async () => {
    const ctx = makeFormatCtx({ accept: 'image/png' })
    await expect(
      formatResponse(ctx, {
        'application/json': () => ({ ok: true }),
      }),
    ).rejects.toMatchObject({
      statusCode: 406,
      code: 'NOT_ACCEPTABLE',
    })
    // Sanity-check the error type.
    try {
      await formatResponse(ctx, { 'application/json': () => ({}) })
    } catch (e) {
      expect(e).toBeInstanceOf(RiftexError)
    }
  })
})

// ────────────────────── isFresh ───────────────────────

describe('isFresh', () => {
  it('true on If-None-Match exact match', () => {
    expect(isFresh({ 'if-none-match': '"abc"' }, { etag: '"abc"' })).toBe(true)
  })

  it('false on If-None-Match mismatch', () => {
    expect(isFresh({ 'if-none-match': '"abc"' }, { etag: '"xyz"' })).toBe(false)
  })

  it('weak/strong tags compare equal under weak normalization', () => {
    expect(isFresh({ 'if-none-match': 'W/"abc"' }, { etag: '"abc"' })).toBe(true)
  })

  it('wildcard If-None-Match matches any current representation', () => {
    expect(isFresh({ 'if-none-match': '*' }, { etag: '"anything"' })).toBe(true)
  })

  it('true on If-Modified-Since when last-modified <= since', () => {
    const since = 'Wed, 21 Oct 2015 07:28:00 GMT'
    const lastMod = 'Wed, 21 Oct 2015 07:00:00 GMT'
    expect(isFresh({ 'if-modified-since': since }, { 'last-modified': lastMod })).toBe(true)
  })

  it('false on If-Modified-Since when resource newer', () => {
    const since = 'Wed, 21 Oct 2015 07:00:00 GMT'
    const lastMod = 'Wed, 21 Oct 2015 08:00:00 GMT'
    expect(isFresh({ 'if-modified-since': since }, { 'last-modified': lastMod })).toBe(false)
  })

  it('false when no precondition headers present', () => {
    expect(isFresh({}, { etag: '"abc"' })).toBe(false)
  })

  it('Cache-Control: no-cache disables 304', () => {
    expect(
      isFresh({ 'if-none-match': '"abc"', 'cache-control': 'no-cache' }, { etag: '"abc"' }),
    ).toBe(false)
  })
})

// ────────────────────── computeEtag ───────────────────────

describe('computeEtag', () => {
  it('is deterministic for the same input', () => {
    const a = computeEtag('hello world')
    const b = computeEtag('hello world')
    expect(a).toBe(b)
  })

  it('differs for different inputs', () => {
    expect(computeEtag('a')).not.toBe(computeEtag('b'))
  })

  it('weak tag is prefixed with W/', () => {
    expect(computeEtag('x', true).startsWith('W/"')).toBe(true)
    expect(computeEtag('x', false).startsWith('"')).toBe(true)
    expect(computeEtag('x', false).startsWith('W/"')).toBe(false)
  })

  it('handles empty body with constant tag', () => {
    expect(computeEtag('')).toBe('W/"2jmj7l5rSw0yVb/vlWAYkK/YBwk="')
  })

  it('accepts Buffer input', () => {
    const buf = Buffer.from('hello world', 'utf8')
    expect(computeEtag(buf)).toBe(computeEtag('hello world'))
  })
})

// ────────────────────── respondJsonWithEtag ───────────────────────

describe('respondJsonWithEtag', () => {
  it('writes full JSON body when no If-None-Match', () => {
    const ctx = makeJsonEtagCtx({})
    respondJsonWithEtag(ctx, { hello: 'world' })
    expect(ctx._statusCode).toBe(200)
    expect(ctx._headers['content-type']).toBe('application/json; charset=utf-8')
    expect(typeof ctx._headers['etag']).toBe('string')
    expect(ctx._body).toEqual({ kind: 'string', data: '{"hello":"world"}' })
    expect(ctx._written).toBe(true)
  })

  it('short-circuits to 304 when If-None-Match matches', () => {
    const body = { x: 1 }
    const expected = computeEtag(JSON.stringify(body), true)
    const ctx = makeJsonEtagCtx({ 'if-none-match': expected })
    respondJsonWithEtag(ctx, body)
    expect(ctx._statusCode).toBe(304)
    expect(ctx._body).toEqual({ kind: 'none' })
    expect(ctx._headers['etag']).toBe(expected)
    expect(ctx._written).toBe(true)
  })

  it('honors weak: false option', () => {
    const ctx = makeJsonEtagCtx({})
    respondJsonWithEtag(ctx, { a: 1 }, { weak: false })
    expect(String(ctx._headers['etag']).startsWith('"')).toBe(true)
    expect(String(ctx._headers['etag']).startsWith('W/"')).toBe(false)
  })

  it('honors custom status', () => {
    const ctx = makeJsonEtagCtx({})
    respondJsonWithEtag(ctx, { a: 1 }, { status: 201 })
    expect(ctx._statusCode).toBe(201)
  })
})
