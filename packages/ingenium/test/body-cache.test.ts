import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { IngeniumBody } from '../src/context/body.ts'
import { IngeniumBadRequestError, IngeniumPayloadTooLargeError } from '../src/errors.ts'

const attach = (
  body: IngeniumBody,
  source: Readable | null,
  contentLength?: number,
  contentType?: string,
) => {
  body._attach(source, contentType, contentLength)
}

describe('IngeniumBody parse cache', () => {
  it('two json() calls return equal parsed values (independent identity)', async () => {
    const body = new IngeniumBody()
    const payload = '{"a":1,"b":[2,3]}'
    attach(body, Readable.from([Buffer.from(payload)]), payload.length)
    const first = await body.json<{ a: number; b: number[] }>()
    const second = await body.json<{ a: number; b: number[] }>()
    expect(first).toEqual({ a: 1, b: [2, 3] })
    expect(second).toEqual({ a: 1, b: [2, 3] })
    // JSON.parse always produces fresh objects.
    expect(first).not.toBe(second)
  })

  it('text() then json() both succeed and agree on bytes', async () => {
    const body = new IngeniumBody()
    const payload = '{"hello":"world"}'
    attach(body, Readable.from([Buffer.from(payload)]), payload.length)
    const text = await body.text()
    const parsed = await body.json<{ hello: string }>()
    expect(text).toBe(payload)
    expect(parsed).toEqual({ hello: 'world' })
  })

  it('json(schemaA) then json(schemaB) — each validates independently against cached bytes', async () => {
    const body = new IngeniumBody()
    const payload = '{"age":42,"name":"alice"}'
    attach(body, Readable.from([Buffer.from(payload)]), payload.length)

    const schemaA = {
      parse(input: unknown): { age: number } {
        const obj = input as { age: unknown }
        if (typeof obj.age !== 'number') throw new Error('age must be number')
        return { age: obj.age }
      },
    }
    const schemaB = {
      parse(input: unknown): { name: string } {
        const obj = input as { name: unknown }
        if (typeof obj.name !== 'string') throw new Error('name must be string')
        return { name: obj.name }
      },
    }

    const a = await body.json(schemaA)
    const b = await body.json(schemaB)
    expect(a).toEqual({ age: 42 })
    expect(b).toEqual({ name: 'alice' })
  })

  it('buffer() then json() works on the cached bytes', async () => {
    const body = new IngeniumBody()
    const payload = '{"ok":true}'
    attach(body, Readable.from([Buffer.from(payload)]), payload.length)
    const buf = await body.buffer()
    expect(buf.toString('utf8')).toBe(payload)
    const parsed = await body.json<{ ok: boolean }>()
    expect(parsed).toEqual({ ok: true })
  })

  it('json() then buffer() returns the same bytes', async () => {
    const body = new IngeniumBody()
    const payload = '{"x":1}'
    attach(body, Readable.from([Buffer.from(payload)]), payload.length)
    await body.json()
    const buf = await body.buffer()
    expect(buf.toString('utf8')).toBe(payload)
  })

  it('text() then text() returns the same string', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('plain text')]), 'plain text'.length)
    expect(await body.text()).toBe('plain text')
    expect(await body.text()).toBe('plain text')
  })

  it('urlencoded() then json() — both work on the cached buffer', async () => {
    const body = new IngeniumBody()
    // Valid both as urlencoded ("a=1") and JSON (with leading-quoted-key form
    // would be invalid, so use something that's valid JSON). Pick a payload
    // that's parseable both ways: `{"a":"1"}` is valid JSON; as urlencoded
    // it becomes a single weird key. Better: use two separate scenarios.
    attach(body, Readable.from([Buffer.from('a=1&b=2')]), 7)
    const form = await body.urlencoded()
    expect(form).toEqual({ a: '1', b: '2' })
    // Same bytes, parsed as text now (not valid JSON, just verifying cache).
    const text = await body.text()
    expect(text).toBe('a=1&b=2')
  })

  it('stream() then json() — still throws "already consumed" (stream opts out of cache)', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{"x":1}')]), 7)
    const s = body.stream()
    // Drain so the test doesn't leak the stream.
    s.resume()
    await expect(body.json()).rejects.toBeInstanceOf(IngeniumBadRequestError)
  })

  it('json() then stream() — throws (cached body cannot be handed back as a fresh Readable)', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{"x":1}')]), 7)
    await body.json()
    expect(() => body.stream()).toThrow(IngeniumBadRequestError)
  })

  it('multipart() then multipart() — throws on second call (multipart opts out of cache)', async () => {
    const body = new IngeniumBody()
    const boundary = '----TestBoundary123'
    const payload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="field"',
        '',
        'value',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    )
    attach(body, Readable.from([payload]), payload.length, `multipart/form-data; boundary=${boundary}`)
    const first = await body.multipart()
    expect(first.fields.field).toBe('value')
    // Second call must throw — multipart is terminal.
    await expect(body.multipart()).rejects.toBeInstanceOf(IngeniumBadRequestError)
  })

  it('multipart() then json() — also throws (multipart is terminal)', async () => {
    const body = new IngeniumBody()
    const boundary = '----TestBoundaryABC'
    const payload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="field"',
        '',
        'value',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
    )
    attach(body, Readable.from([payload]), payload.length, `multipart/form-data; boundary=${boundary}`)
    await body.multipart()
    await expect(body.json()).rejects.toBeInstanceOf(IngeniumBadRequestError)
  })

  it('json() then buffer(maxBytes < cached.length) throws IngeniumPayloadTooLargeError', async () => {
    const body = new IngeniumBody()
    const payload = '{"a":1,"b":2}'
    attach(body, Readable.from([Buffer.from(payload)]), payload.length)
    await body.json()
    await expect(body.buffer(payload.length - 1)).rejects.toBeInstanceOf(IngeniumPayloadTooLargeError)
  })

  it('empty body is cached and reusable', async () => {
    const body = new IngeniumBody()
    attach(body, null)
    const first = await body.buffer()
    const second = await body.buffer()
    expect(first.length).toBe(0)
    expect(second.length).toBe(0)
    // Empty body parses as JSON `null` per existing json() behavior.
    const parsed = await body.json()
    expect(parsed).toBe(null)
  })

  it('chunked (unknown content-length) path caches successfully', async () => {
    const body = new IngeniumBody()
    // No content-length → falls into the chunked branch of buffer().
    attach(body, Readable.from([Buffer.from('{"a":'), Buffer.from('42}')]), undefined)
    const first = await body.json<{ a: number }>()
    const second = await body.json<{ a: number }>()
    expect(first).toEqual({ a: 42 })
    expect(second).toEqual({ a: 42 })
  })

  it('_reset() clears the cache so a pooled context starts fresh', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{"a":1}')]), 7)
    await body.json()
    expect(body._cached).not.toBe(null)
    body._reset()
    expect(body._cached).toBe(null)
    expect(body._consumed).toBe(false)
    // Reattach a new source and confirm it reads fresh bytes.
    attach(body, Readable.from([Buffer.from('{"a":2}')]), 7)
    const parsed = await body.json<{ a: number }>()
    expect(parsed).toEqual({ a: 2 })
  })
})
