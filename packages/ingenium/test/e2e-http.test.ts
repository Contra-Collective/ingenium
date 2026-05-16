import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Agent, request as httpRequest, type IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { ingenium } from '../src/index.ts'
import { Router } from '../src/router/router.ts'
import { IngeniumValidationError } from '../src/errors.ts'
import type { ListeningServer } from '../src/transport/types.ts'
import type { IngeniumApp } from '../src/app.ts'

/** Boot an app on an ephemeral port and return its `ListeningServer` handle. */
async function start(app: IngeniumApp): Promise<ListeningServer> {
  return app.listen(0, '127.0.0.1')
}

function url(server: ListeningServer, path: string): string {
  return `http://127.0.0.1:${server.port}${path}`
}

// ───────────────────────────────────────────────────────────────────────────
// Returning values from handlers
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: handler return — string', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', () => 'hello world')
    server = await start(app)
  })
  afterAll(() => server.close())

  it('returns 200 text/plain with matching body', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/plain/)
    expect(await res.text()).toBe('hello world')
  })
})

describe('e2e: handler return — JSON object', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', () => ({ ok: true }))
    server = await start(app)
  })
  afterAll(() => server.close())

  it('returns 200 application/json with parseable body', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ ok: true })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Routing
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: route params', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/users/:id', (ctx) => ({ id: ctx.params.id }))
    server = await start(app)
  })
  afterAll(() => server.close())

  it('extracts :id and reflects it in JSON', async () => {
    const res = await fetch(url(server, '/users/abc123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'abc123' })
  })
})

describe('e2e: POST /echo with JSON body', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.post('/echo', async (ctx) => {
      const body = await ctx.body.json()
      return body
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('round-trips a JSON body verbatim', async () => {
    const payload = { hello: 'world', n: 42, nested: { ok: true, arr: [1, 2, 3] } }
    const res = await fetch(url(server, '/echo'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(payload)
  })
})

describe('e2e: POST with content-length 0', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    let ran = false
    app.post('/', () => {
      ran = true
      // returning undefined → reflectReturn yields 204
    })
    // Expose for the test
    ;(app as unknown as { _ran: () => boolean })._ran = () => ran
    server = await start(app)
  })
  afterAll(() => server.close())

  it('runs the handler and returns 204', async () => {
    const res = await fetch(url(server, '/'), {
      method: 'POST',
      headers: { 'content-length': '0' },
    })
    expect(res.status).toBe(204)
  })
})

describe('e2e: 404 missing route', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/known', () => 'ok')
    server = await start(app)
  })
  afterAll(() => server.close())

  it('returns JSON {error, code:NOT_FOUND}', async () => {
    const res = await fetch(url(server, '/unknown'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('NOT_FOUND')
    expect(typeof body.error).toBe('string')
  })
})

describe('e2e: 405 wrong method', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/only-get', () => 'ok')
    app.post('/only-get', () => 'posted')
    server = await start(app)
  })
  afterAll(() => server.close())

  it('returns 405 with Allow header listing valid methods', async () => {
    const res = await fetch(url(server, '/only-get'), { method: 'DELETE' })
    expect(res.status).toBe(405)
    const allow = res.headers.get('allow') ?? ''
    // Order isn't guaranteed — just assert membership.
    const allowed = allow.split(',').map((s) => s.trim())
    expect(allowed).toContain('GET')
    expect(allowed).toContain('POST')
  })
})

describe('e2e: sub-router mounted at /api', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    const api = new Router()
    api.get('/users/:id', (ctx) => ({ scope: 'api', id: ctx.params.id }))
    app.use('/api', api)
    server = await start(app)
  })
  afterAll(() => server.close())

  it('resolves prefixed routes and extracts params', async () => {
    const res = await fetch(url(server, '/api/users/77'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scope: 'api', id: '77' })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Middleware ordering
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: middleware order A → handler → B', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.use(async (ctx, next) => {
      ctx.set('x-mw-a-before', '1')
      await next()
      // After-next: only safe to set headers if the handler used a streamy/lazy body.
      // The handler here uses ctx.json which has already serialized — but headers
      // haven't been written to the wire yet (writeResponse runs AFTER dispatch),
      // so a header set here still makes it onto the response.
      ctx.set('x-mw-a-after', '1')
    })
    app.use(async (ctx, next) => {
      ctx.set('x-mw-b-before', '1')
      await next()
      ctx.set('x-mw-b-after', '1')
    })
    app.get('/', (ctx) => {
      ctx.set('x-handler', '1')
      ctx.json({ ok: true })
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('all four "around" headers + handler header arrive on the response', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-mw-a-before')).toBe('1')
    expect(res.headers.get('x-mw-b-before')).toBe('1')
    expect(res.headers.get('x-handler')).toBe('1')
    expect(res.headers.get('x-mw-b-after')).toBe('1')
    expect(res.headers.get('x-mw-a-after')).toBe('1')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Error boundary
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: throw → onError handler', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', () => {
      throw new Error('boom')
    })
    app.onError((err, ctx) => {
      ctx.json({ caught: true, message: (err as Error).message }, 503)
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('lets onError write a custom status + body', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ caught: true, message: 'boom' })
  })
})

describe('e2e: throw IngeniumValidationError → default boundary', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', () => {
      throw new IngeniumValidationError({ email: 'is required', age: 'must be > 0' })
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('serializes 422 with code + fields', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(422)
    const body = (await res.json()) as {
      error: string
      code: string
      fields: Record<string, string>
    }
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.fields).toEqual({ email: 'is required', age: 'must be > 0' })
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Body shapes
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: large response body (1 MB)', () => {
  const SIZE = 1024 * 1024
  const PAYLOAD = 'x'.repeat(SIZE)
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', (ctx) => {
      ctx.text(PAYLOAD)
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('Content-Length is exact and body is intact', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(SIZE))
    const body = await res.text()
    expect(body.length).toBe(SIZE)
    expect(body).toBe(PAYLOAD)
  })
})

describe('e2e: streamed response via ctx.stream()', () => {
  const CHUNKS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', (ctx) => {
      ctx.stream(Readable.from(CHUNKS), 'text/plain; charset=utf-8')
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('arrives chunked, all chunks present and ordered', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe(CHUNKS.join(''))
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Concurrency — proves context-pool isolation
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: concurrent requests', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/n/:n', async (ctx) => {
      // Tiny async hop to encourage interleaving.
      await new Promise((r) => setTimeout(r, 1))
      return { n: ctx.params.n }
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('50 parallel fetches each get their own param back', async () => {
    const N = 50
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        fetch(url(server, `/n/${i}`)).then((r) => r.json() as Promise<{ n: string }>),
      ),
    )
    for (let i = 0; i < N; i++) {
      expect(results[i]).toEqual({ n: String(i) })
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Header handling
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: header case-insensitivity', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', (ctx) => {
      // Node lowercases header names; verify a mixed-case sender still resolves
      // via the lowercase key.
      const v = ctx.headers['x-custom']
      return { received: v ?? null }
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('reads X-CUSTOM via lowercased ctx.headers["x-custom"]', async () => {
    const res = await fetch(url(server, '/'), {
      headers: { 'X-CUSTOM': 'hello' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: 'hello' })
  })
})

describe('e2e: multiple Set-Cookie headers', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    app.get('/', (ctx) => {
      ctx.set('set-cookie', ['a=1; Path=/', 'b=2; Path=/'])
      ctx.json({ ok: true })
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  it('arrive as multiple Set-Cookie lines (fetch getSetCookie)', async () => {
    const res = await fetch(url(server, '/'))
    expect(res.status).toBe(200)
    // Node's undici fetch exposes getSetCookie() returning string[].
    const cookies = res.headers.getSetCookie()
    expect(cookies).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Keep-alive
// ───────────────────────────────────────────────────────────────────────────

describe('e2e: keep-alive on a single connection', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = ingenium()
    let count = 0
    app.get('/', () => {
      count++
      return { count }
    })
    server = await start(app)
  })
  afterAll(() => server.close())

  /** Send one GET / through the given agent; resolve with status+body+socket id. */
  function getKeepAlive(
    agent: Agent,
  ): Promise<{ status: number; body: string; socketKey: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          method: 'GET',
          path: '/',
          agent,
          headers: { connection: 'keep-alive' },
        },
        (res: IncomingMessage) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (c: string) => {
            body += c
          })
          res.on('end', () => {
            const sock = res.socket
            const key =
              sock && 'remotePort' in sock && sock.remotePort
                ? `${sock.remoteAddress}:${sock.remotePort}`
                : 'no-socket'
            resolve({ status: res.statusCode ?? 0, body, socketKey: key })
          })
          res.on('error', reject)
        },
      )
      req.once('error', reject)
      req.end()
    })
  }

  it('three sequential requests share one socket', async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const a = await getKeepAlive(agent)
      const b = await getKeepAlive(agent)
      const c = await getKeepAlive(agent)
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(c.status).toBe(200)
      expect(JSON.parse(a.body)).toEqual({ count: 1 })
      expect(JSON.parse(b.body)).toEqual({ count: 2 })
      expect(JSON.parse(c.body)).toEqual({ count: 3 })
      // Same socket reused across all three (keep-alive proof).
      expect(a.socketKey).toBe(b.socketKey)
      expect(b.socketKey).toBe(c.socketKey)
    } finally {
      agent.destroy()
    }
  })
})
