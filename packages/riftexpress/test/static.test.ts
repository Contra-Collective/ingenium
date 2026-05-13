import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { RiftexContext } from '../src/context/context.ts'
import { staticMiddleware } from '../src/static/middleware.ts'

let ROOT: string
const FILES = {
  'hello.txt': 'hello world\n',
  'app.css': 'body { color: red }',
  'index.html': '<!doctype html><title>root</title>',
  '.secret': 'shh',
}

beforeAll(() => {
  ROOT = mkdtempSync(path.join(os.tmpdir(), 'riftex-static-'))
  for (const [name, content] of Object.entries(FILES)) {
    writeFileSync(path.join(ROOT, name), content)
  }
  // Subdirectory with an index.html so a directory-style URL resolves.
  mkdirSync(path.join(ROOT, 'sub'))
  writeFileSync(path.join(ROOT, 'sub', 'index.html'), '<p>sub</p>')
  // Larger binary file for range testing.
  writeFileSync(path.join(ROOT, 'data.bin'), Buffer.from('0123456789ABCDEF'))
})

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

function makeCtx(p: string, headers: Record<string, string> = {}): RiftexContext {
  const ctx = new RiftexContext()
  ctx.method = 'GET'
  ctx.path = p
  ctx.url = p
  ctx.headers = headers
  return ctx
}

async function readStream(r: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of r) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function bodyAsStream(ctx: RiftexContext): Readable {
  if (ctx._body.kind !== 'stream') throw new Error(`expected stream body, got ${ctx._body.kind}`)
  return ctx._body.data
}

describe('staticMiddleware', () => {
  it('serves a file with correct content-type and content-length', async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/hello.txt')
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(ctx._statusCode).toBe(200)
    expect(ctx.getHeader('content-type')).toBe('text/plain; charset=utf-8')
    expect(ctx.getHeader('content-length')).toBe(String(FILES['hello.txt'].length))
    const buf = await readStream(bodyAsStream(ctx))
    expect(buf.toString('utf8')).toBe(FILES['hello.txt'])
  })

  it('sets a weak ETag and last-modified', async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/app.css')
    await mw(ctx, async () => {})
    const etag = ctx.getHeader('etag')
    expect(typeof etag).toBe('string')
    expect((etag as string).startsWith('W/"')).toBe(true)
    expect(ctx.getHeader('last-modified')).toBeTruthy()
    expect(ctx.getHeader('content-type')).toBe('text/css; charset=utf-8')
    // drain
    await readStream(bodyAsStream(ctx))
  })

  it('responds 304 when If-None-Match matches the ETag', async () => {
    const mw = staticMiddleware(ROOT)
    const probe = makeCtx('/hello.txt')
    await mw(probe, async () => {})
    const etag = probe.getHeader('etag') as string
    await readStream(bodyAsStream(probe))

    const ctx = makeCtx('/hello.txt', { 'if-none-match': etag })
    await mw(ctx, async () => {})
    expect(ctx._statusCode).toBe(304)
    expect(ctx._body.kind).toBe('none')
  })

  it('honors Range requests with 206 + Content-Range', async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/data.bin', { range: 'bytes=2-5' })
    await mw(ctx, async () => {})
    expect(ctx._statusCode).toBe(206)
    expect(ctx.getHeader('content-range')).toBe('bytes 2-5/16')
    expect(ctx.getHeader('accept-ranges')).toBe('bytes')
    expect(ctx.getHeader('content-length')).toBe('4')
    const buf = await readStream(bodyAsStream(ctx))
    expect(buf.toString('utf8')).toBe('2345')
  })

  it('returns 416 for an unsatisfiable Range', async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/data.bin', { range: 'bytes=999-1000' })
    await mw(ctx, async () => {})
    expect(ctx._statusCode).toBe(416)
    expect(ctx.getHeader('content-range')).toBe('bytes */16')
  })

  it("calls next() for dotfiles when policy is 'ignore' (default)", async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/.secret')
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ctx._written).toBe(false)
  })

  it("denies dotfiles with 403 when policy is 'deny'", async () => {
    const mw = staticMiddleware(ROOT, { dotfiles: 'deny' })
    const ctx = makeCtx('/.secret')
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(ctx._statusCode).toBe(403)
  })

  it('rejects path traversal with 403', async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/../etc/passwd')
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(false)
    expect(ctx._statusCode).toBe(403)
  })

  it('calls next() for missing files (does NOT 404 itself)', async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/does-not-exist.png')
    let nextCalled = false
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ctx._written).toBe(false)
  })

  it('serves index.html when a directory is requested', async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/sub')
    await mw(ctx, async () => {})
    expect(ctx._statusCode).toBe(200)
    expect(ctx.getHeader('content-type')).toBe('text/html; charset=utf-8')
    const buf = await readStream(bodyAsStream(ctx))
    expect(buf.toString('utf8')).toBe('<p>sub</p>')
  })

  it("serves root '/' index.html when present", async () => {
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/')
    await mw(ctx, async () => {})
    expect(ctx._statusCode).toBe(200)
    expect(ctx.getHeader('content-type')).toBe('text/html; charset=utf-8')
    const buf = await readStream(bodyAsStream(ctx))
    expect(buf.toString('utf8')).toBe(FILES['index.html'])
  })

  it('sets Cache-Control from maxAge (ms → seconds)', async () => {
    const mw = staticMiddleware(ROOT, { maxAge: 60_000 })
    const ctx = makeCtx('/hello.txt')
    await mw(ctx, async () => {})
    expect(ctx.getHeader('cache-control')).toBe('public, max-age=60')
    await readStream(bodyAsStream(ctx))
  })

  it('returns octet-stream for unknown extensions', async () => {
    const fp = path.join(ROOT, 'mystery.xyz')
    writeFileSync(fp, 'mystery')
    const mw = staticMiddleware(ROOT)
    const ctx = makeCtx('/mystery.xyz')
    await mw(ctx, async () => {})
    expect(ctx.getHeader('content-type')).toBe('application/octet-stream')
    await readStream(bodyAsStream(ctx))
    // confirm fixture really existed (silence unused-import / dead-code lints)
    expect(statSync(fp).isFile()).toBe(true)
  })
})
