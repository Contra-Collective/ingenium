import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { IngeniumBody } from '../src/context/body.ts'
import { IngeniumBadRequestError, IngeniumPayloadTooLargeError, IngeniumValidationError } from '../src/errors.ts'

const attach = (body: IngeniumBody, source: Readable | null, contentLength?: number, contentType?: string) => {
  body._attach(source, contentType, contentLength)
}

describe('IngeniumBody', () => {
  it('buffer() reads all chunks from the stream', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('hello '), Buffer.from('world')]))
    const buf = await body.buffer()
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.toString('utf8')).toBe('hello world')
  })

  it('text() decodes UTF-8', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('héllo 🌍', 'utf8')]))
    expect(await body.text()).toBe('héllo 🌍')
  })

  it('json() parses JSON', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{"a":1,"b":[2,3]}')]))
    const parsed = await body.json<{ a: number; b: number[] }>()
    expect(parsed).toEqual({ a: 1, b: [2, 3] })
  })

  it('json() throws IngeniumBadRequestError on malformed JSON', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{not json')]))
    await expect(body.json()).rejects.toBeInstanceOf(IngeniumBadRequestError)
  })

  it('json(schema) with safeParse-style schema throws IngeniumValidationError on failure', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{"age":"NaN"}')]))
    const schema = {
      safeParse(input: unknown) {
        const obj = input as { age: unknown }
        if (typeof obj.age !== 'number') {
          return {
            success: false as const,
            error: { issues: [{ path: ['age'], message: 'Expected number' }] },
          }
        }
        return { success: true as const, data: obj as { age: number } }
      },
    }
    try {
      await body.json(schema)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(IngeniumValidationError)
      expect((err as IngeniumValidationError).fields).toEqual({ age: 'Expected number' })
    }
  })

  it('json(schema) with parse-style schema validates successfully', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{"name":"alice"}')]))
    const schema = {
      parse(input: unknown): { name: string } {
        const obj = input as { name: unknown }
        if (typeof obj.name !== 'string') throw new Error('name required')
        return { name: obj.name }
      },
    }
    const parsed = await body.json(schema)
    expect(parsed).toEqual({ name: 'alice' })
  })

  it('json(schema) with parse-style schema throws IngeniumValidationError on throw', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('{}')]))
    const schema = {
      parse(): never {
        throw new Error('name required')
      },
    }
    await expect(body.json(schema)).rejects.toBeInstanceOf(IngeniumValidationError)
  })

  it('urlencoded() parses key=value form bodies', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('a=1&b=hello%20world&c=')]))
    const parsed = await body.urlencoded()
    expect(parsed).toEqual({ a: '1', b: 'hello world', c: '' })
  })

  it('throws IngeniumPayloadTooLargeError immediately when content-length exceeds maxBytes', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('aaaaaaaaaa')]), 10)
    await expect(body.buffer(5)).rejects.toBeInstanceOf(IngeniumPayloadTooLargeError)
  })

  it('throws IngeniumPayloadTooLargeError mid-stream when stream exceeds without content-length', async () => {
    const body = new IngeniumBody()
    // No content-length passed → the limiter Transform must catch it.
    const chunks = [Buffer.alloc(4, 'a'), Buffer.alloc(4, 'b'), Buffer.alloc(4, 'c')]
    attach(body, Readable.from(chunks), undefined)
    await expect(body.buffer(8)).rejects.toBeInstanceOf(IngeniumPayloadTooLargeError)
  })

  it('stream() throws IngeniumBadRequestError if body already consumed', async () => {
    const body = new IngeniumBody()
    attach(body, Readable.from([Buffer.from('x')]))
    await body.text()
    expect(() => body.stream()).toThrow(IngeniumBadRequestError)
  })

  it('stream() returns the underlying Readable on first call', () => {
    const body = new IngeniumBody()
    const src = Readable.from([Buffer.from('x')])
    attach(body, src)
    expect(body.stream()).toBe(src)
    // second call should now throw
    expect(() => body.stream()).toThrow(IngeniumBadRequestError)
  })

  it('buffer() returns empty Buffer when no source attached', async () => {
    const body = new IngeniumBody()
    attach(body, null)
    const buf = await body.buffer()
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBe(0)
  })
})
