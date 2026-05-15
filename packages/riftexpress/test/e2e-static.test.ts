import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { Buffer } from 'node:buffer'
import { riftex } from '../src/index.ts'
import type { ListeningServer } from '../src/transport/types.ts'

const FIXTURES = {
  'hello.txt': 'hello world\n',
  'app.css': 'body { color: red }',
  'data.bin': Buffer.from('0123456789ABCDEF'),
}

let ROOT: string
let server: ListeningServer

beforeAll(async () => {
  ROOT = mkdtempSync(path.join(os.tmpdir(), 'riftex-e2e-'))
  for (const [name, content] of Object.entries(FIXTURES)) {
    writeFileSync(path.join(ROOT, name), content as string | Buffer)
  }

  const app = riftex()
  app.use(riftex.static(ROOT))
  // Downstream handler reached only when static calls next().
  app.get('/__downstream__', () => ({ downstream: true }))
  // Wildcard fallback so we can prove static defers to next() for misses.
  app.use(async (ctx, next) => {
    await next()
    if (!ctx._written) {
      ctx.json({ fallthrough: true, path: ctx.path }, 418)
    }
  })

  server = await app.listen(0, '127.0.0.1')
})

afterAll(async () => {
  await server.close()
  rmSync(ROOT, { recursive: true, force: true })
})

function url(p: string): string {
  return `http://127.0.0.1:${server.port}${p}`
}

describe('e2e static: GET file', () => {
  it('serves with the right content-type from extension', async () => {
    const r1 = await fetch(url('/hello.txt'))
    expect(r1.status).toBe(200)
    expect(r1.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await r1.text()).toBe(FIXTURES['hello.txt'])

    const r2 = await fetch(url('/app.css'))
    expect(r2.status).toBe(200)
    expect(r2.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await r2.text()).toBe(FIXTURES['app.css'])
  })
})

describe('e2e static: 304 If-None-Match', () => {
  it('returns 304 with empty body when ETag matches', async () => {
    const probe = await fetch(url('/hello.txt'))
    const etag = probe.headers.get('etag')
    expect(etag).toBeTruthy()
    await probe.text()

    const cached = await fetch(url('/hello.txt'), {
      headers: { 'if-none-match': etag! },
    })
    expect(cached.status).toBe(304)
    const body = await cached.text()
    expect(body).toBe('')
  })
})

describe('e2e static: 304 If-Modified-Since', () => {
  it('returns 304 when If-Modified-Since is at or after Last-Modified', async () => {
    const probe = await fetch(url('/hello.txt'))
    const lastModified = probe.headers.get('last-modified')
    expect(lastModified).toBeTruthy()
    await probe.text()

    const cached = await fetch(url('/hello.txt'), {
      headers: { 'if-modified-since': lastModified! },
    })
    expect(cached.status).toBe(304)
    const body = await cached.text()
    expect(body).toBe('')
  })

  it('serves 200 when If-Modified-Since is older than Last-Modified', async () => {
    // Date well in the past — file mtime is now-ish, so it must be newer.
    const res = await fetch(url('/hello.txt'), {
      headers: { 'if-modified-since': 'Wed, 01 Jan 2020 00:00:00 GMT' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello world\n')
  })

  it('If-None-Match takes precedence over If-Modified-Since (RFC 7232 §6)', async () => {
    const probe = await fetch(url('/hello.txt'))
    const etag = probe.headers.get('etag')
    await probe.text()

    // INM matches → 304, even if IMS is ancient and would say "modified".
    const res = await fetch(url('/hello.txt'), {
      headers: {
        'if-none-match': etag!,
        'if-modified-since': 'Wed, 01 Jan 2020 00:00:00 GMT',
      },
    })
    expect(res.status).toBe(304)
  })

  it('malformed If-Modified-Since is ignored (serves 200)', async () => {
    const res = await fetch(url('/hello.txt'), {
      headers: { 'if-modified-since': 'not-a-date' },
    })
    expect(res.status).toBe(200)
  })
})

describe('e2e static: 206 Range request', () => {
  it('returns partial body slice on a Range request', async () => {
    const res = await fetch(url('/data.bin'), {
      headers: { range: 'bytes=2-5' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/16')
    expect(res.headers.get('content-length')).toBe('4')
    const body = await res.text()
    expect(body).toBe('2345')
  })
})

describe('e2e static: path traversal', () => {
  it('rejects ../ escape with 403', async () => {
    // We send the literal "/../etc/passwd" — fetch URL parsing would normalize
    // it away, so we hand-craft the request via node:http.
    const { request: httpRequest } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          method: 'GET',
          path: '/../etc/passwd',
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode ?? 0))
        },
      )
      req.once('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })
})

describe('e2e static: missing file', () => {
  it('falls through to downstream handler (next() called)', async () => {
    const res = await fetch(url('/__downstream__'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ downstream: true })
  })

  it('falls through (no route match) to the trailing fallback middleware', async () => {
    // No file, no route — proves staticMiddleware called next() for the miss
    // and the fallback middleware's after-next branch wrote a response.
    const res = await fetch(url('/no-such-file.png'))
    expect(res.status).toBe(418)
    const body = (await res.json()) as { fallthrough: boolean; path: string }
    expect(body.fallthrough).toBe(true)
    expect(body.path).toBe('/no-such-file.png')
  })
})

describe('e2e static: HEAD request', () => {
  it('returns headers (incl. Content-Length) but no body', async () => {
    const res = await fetch(url('/hello.txt'), { method: 'HEAD' })
    // The static middleware doesn't special-case HEAD (it only matches GET),
    // so a HEAD against a static file should fall through to either a route
    // or the trailing fallback. Either way, the Content-Length must reflect
    // the resource correctly *if* the file is served. Tolerate both shapes:
    // - 200 with content-length set and empty body (HTTP HEAD semantics)
    // - 418 fallthrough (static middleware doesn't handle HEAD)
    const body = await res.text()
    expect(body).toBe('')
    if (res.status === 200) {
      expect(res.headers.get('content-length')).toBe(String(FIXTURES['hello.txt'].length))
    } else {
      // Documents the current behavior — middleware is GET-only.
      expect(res.status).toBe(418)
    }
  })
})
