import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { RiftexBody } from '../src/context/body.ts'
import { RiftexBadRequestError, RiftexPayloadTooLargeError } from '../src/errors.ts'
import type { MultipartFile } from '../src/body/multipart-types.ts'

const BOUNDARY = '----RiftexTestBoundary'
const CT = `multipart/form-data; boundary=${BOUNDARY}`

const attach = (body: RiftexBody, source: Readable | null, contentType?: string, contentLength?: number) => {
  body._attach(source, contentType, contentLength)
}

const fromBuf = (buf: Buffer): Readable => Readable.from([buf])

/**
 * Build a multipart body from typed parts.
 * Each part may be a plain field (no filename) or a file (with filename + optional content-type).
 */
type TestPart =
  | { name: string; value: string | Buffer }
  | { name: string; filename: string; contentType?: string; value: string | Buffer }

function buildBody(parts: TestPart[], { closing = true }: { closing?: boolean } = {}): Buffer {
  const chunks: Buffer[] = []
  for (const p of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`))
    if ('filename' in p) {
      const ct = p.contentType ?? 'application/octet-stream'
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
            `Content-Type: ${ct}\r\n\r\n`,
        ),
      )
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`))
    }
    chunks.push(typeof p.value === 'string' ? Buffer.from(p.value, 'utf8') : p.value)
    chunks.push(Buffer.from('\r\n'))
  }
  if (closing) chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`))
  return Buffer.concat(chunks)
}

describe('RiftexBody.multipart()', () => {
  it('parses a single text field', async () => {
    const body = new RiftexBody()
    const buf = buildBody([{ name: 'greeting', value: 'hello' }])
    attach(body, fromBuf(buf), CT)
    const result = await body.multipart()
    expect(result.fields).toEqual({ greeting: 'hello' })
    expect(result.files).toEqual({})
  })

  it('collapses repeated field names into an array', async () => {
    const body = new RiftexBody()
    const buf = buildBody([
      { name: 'tag', value: 'a' },
      { name: 'tag', value: 'b' },
      { name: 'tag', value: 'c' },
    ])
    attach(body, fromBuf(buf), CT)
    const result = await body.multipart()
    expect(result.fields).toEqual({ tag: ['a', 'b', 'c'] })
  })

  it('parses a single file with filename + content-type', async () => {
    const body = new RiftexBody()
    const fileBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])
    const buf = buildBody([
      { name: 'avatar', filename: 'pic.png', contentType: 'image/png', value: fileBytes },
    ])
    attach(body, fromBuf(buf), CT)
    const result = await body.multipart()
    expect(result.fields).toEqual({})
    const file = result.files.avatar as MultipartFile
    expect(file.filename).toBe('pic.png')
    expect(file.mimeType).toBe('image/png')
    expect(file.size).toBe(fileBytes.length)
    expect(Buffer.compare(file.data, fileBytes)).toBe(0)
  })

  it('parses mixed fields and files', async () => {
    const body = new RiftexBody()
    const photo = Buffer.from('IMAGE-BYTES')
    const buf = buildBody([
      { name: 'username', value: 'alice' },
      { name: 'photo', filename: 'a.jpg', contentType: 'image/jpeg', value: photo },
      { name: 'bio', value: 'hello world' },
    ])
    attach(body, fromBuf(buf), CT)
    const result = await body.multipart()
    expect(result.fields).toEqual({ username: 'alice', bio: 'hello world' })
    const file = result.files.photo as MultipartFile
    expect(file.filename).toBe('a.jpg')
    expect(file.mimeType).toBe('image/jpeg')
    expect(file.data.toString('utf8')).toBe('IMAGE-BYTES')
  })

  it('rejects Content-Type without boundary', async () => {
    const body = new RiftexBody()
    attach(body, fromBuf(Buffer.from('x')), 'multipart/form-data')
    await expect(body.multipart()).rejects.toBeInstanceOf(RiftexBadRequestError)
  })

  it('rejects non-multipart Content-Type', async () => {
    const body = new RiftexBody()
    attach(body, fromBuf(Buffer.from('{}')), 'application/json')
    await expect(body.multipart()).rejects.toBeInstanceOf(RiftexBadRequestError)
  })

  it('rejects body exceeding maxBytes (413)', async () => {
    const body = new RiftexBody()
    const buf = buildBody([{ name: 'big', value: 'x'.repeat(500) }])
    // Pass content-length so the check fires immediately.
    attach(body, fromBuf(buf), CT, buf.length)
    await expect(body.multipart({ maxBytes: 100 })).rejects.toBeInstanceOf(RiftexPayloadTooLargeError)
  })

  it('rejects file exceeding maxFileSize (413)', async () => {
    const body = new RiftexBody()
    const big = Buffer.alloc(2000, 0x41)
    const buf = buildBody([
      { name: 'upload', filename: 'big.bin', contentType: 'application/octet-stream', value: big },
    ])
    attach(body, fromBuf(buf), CT)
    await expect(
      body.multipart({ maxBytes: 10_000, maxFileSize: 1000 }),
    ).rejects.toBeInstanceOf(RiftexPayloadTooLargeError)
  })

  it('rejects too many files (400)', async () => {
    const body = new RiftexBody()
    const buf = buildBody([
      { name: 'f1', filename: 'a.bin', value: Buffer.from('a') },
      { name: 'f2', filename: 'b.bin', value: Buffer.from('b') },
      { name: 'f3', filename: 'c.bin', value: Buffer.from('c') },
    ])
    attach(body, fromBuf(buf), CT)
    await expect(body.multipart({ maxFiles: 2 })).rejects.toBeInstanceOf(RiftexBadRequestError)
  })

  it('rejects too many fields (400)', async () => {
    const body = new RiftexBody()
    const buf = buildBody([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' },
    ])
    attach(body, fromBuf(buf), CT)
    await expect(body.multipart({ maxFields: 2 })).rejects.toBeInstanceOf(RiftexBadRequestError)
  })

  it('rejects disallowed mime type (400)', async () => {
    const body = new RiftexBody()
    const buf = buildBody([
      { name: 'doc', filename: 'evil.exe', contentType: 'application/x-msdownload', value: Buffer.from('MZ') },
    ])
    attach(body, fromBuf(buf), CT)
    await expect(
      body.multipart({ allowedMimePrefixes: ['image/'] }),
    ).rejects.toBeInstanceOf(RiftexBadRequestError)
  })

  it('rejects malformed body (missing closing boundary)', async () => {
    const body = new RiftexBody()
    const buf = buildBody([{ name: 'x', value: 'y' }], { closing: false })
    attach(body, fromBuf(buf), CT)
    await expect(body.multipart()).rejects.toBeInstanceOf(RiftexBadRequestError)
  })

  it('returns empty result for empty body', async () => {
    const body = new RiftexBody()
    attach(body, null, CT)
    const result = await body.multipart()
    expect(result).toEqual({ fields: {}, files: {} })
  })

  it('preserves binary content when boundary-like bytes appear inside a file', async () => {
    const body = new RiftexBody()
    // Embed bytes that *look* like the boundary prefix but aren't a real delimiter.
    const tricky = Buffer.concat([
      Buffer.from('header-bytes\n--'),
      Buffer.from(BOUNDARY.slice(0, 4)),
      Buffer.from('\nmore-bytes'),
    ])
    const buf = buildBody([
      { name: 'blob', filename: 'tricky.bin', value: tricky },
    ])
    attach(body, fromBuf(buf), CT)
    const result = await body.multipart()
    const file = result.files.blob as MultipartFile
    expect(Buffer.compare(file.data, tricky)).toBe(0)
  })

  it('parses quoted boundary in Content-Type', async () => {
    const body = new RiftexBody()
    const buf = buildBody([{ name: 'a', value: '1' }])
    attach(body, fromBuf(buf), `multipart/form-data; boundary="${BOUNDARY}"`)
    const result = await body.multipart()
    expect(result.fields).toEqual({ a: '1' })
  })
})
