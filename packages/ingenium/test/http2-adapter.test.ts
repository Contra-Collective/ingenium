import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { connect as h2connect, constants as h2, type ClientHttp2Session } from 'node:http2'
import { Buffer } from 'node:buffer'
import { IngeniumApp } from '../src/app.ts'
import { Http2cAdapter } from '../src/transport/http2.ts'
import type { ListeningServer } from '../src/transport/types.ts'

/**
 * h2c (cleartext HTTP/2) is testable end-to-end without TLS certificates,
 * which keeps these tests hermetic. The h2 (TLS) variant requires a cert
 * pair — see the skipped block at the bottom.
 */

interface H2Response {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

/**
 * Issue a single HTTP/2 request and return the full response.
 * Manual session management — Node's http2 client doesn't auto-close.
 */
function h2request(
  client: ClientHttp2Session,
  reqHeaders: Record<string, string | number>,
  body?: Buffer | string,
): Promise<H2Response> {
  return new Promise((resolve, reject) => {
    const stream = client.request(reqHeaders, { endStream: body === undefined })
    let status = 0
    let respHeaders: Record<string, string | string[] | undefined> = {}
    const chunks: Buffer[] = []

    stream.on('response', (h) => {
      status = Number(h[h2.HTTP2_HEADER_STATUS] ?? 0)
      respHeaders = { ...h }
      delete respHeaders[h2.HTTP2_HEADER_STATUS]
    })
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end', () => resolve({ status, headers: respHeaders, body: Buffer.concat(chunks) }))
    stream.on('error', reject)

    if (body !== undefined) stream.end(body)
  })
}

describe('Http2cAdapter (h2c)', () => {
  let server: ListeningServer
  let client: ClientHttp2Session
  let baseUrl: string

  beforeAll(async () => {
    const app = new IngeniumApp({ transport: new Http2cAdapter() })

    app.get('/', (ctx) => {
      ctx.text('hello')
    })

    app.get('/users/:id', (ctx) => {
      ctx.json({ id: ctx.params.id })
    })

    app.post('/echo', async (ctx) => {
      const data = await ctx.body.json<{ msg: string }>()
      ctx.json({ echoed: data.msg }, 201)
    })

    server = await app.listen(0)
    baseUrl = `http://${server.host}:${server.port}`
    client = h2connect(baseUrl)
    // Prevent unhandled errors from crashing the test runner if the connection
    // dies mid-suite (e.g. server close races a stream).
    client.on('error', () => {})
  })

  afterAll(async () => {
    await new Promise<void>((res) => client.close(() => res()))
    await server.close({ gracefulTimeoutMs: 50 })
  })

  it('responds to GET / with text body', async () => {
    const r = await h2request(client, { [h2.HTTP2_HEADER_METHOD]: 'GET', [h2.HTTP2_HEADER_PATH]: '/' })
    expect(r.status).toBe(200)
    expect(String(r.headers['content-type'])).toMatch(/text\/plain/)
    expect(r.body.toString('utf8')).toBe('hello')
  })

  it('extracts path params via /users/:id', async () => {
    const r = await h2request(client, { [h2.HTTP2_HEADER_METHOD]: 'GET', [h2.HTTP2_HEADER_PATH]: '/users/42' })
    expect(r.status).toBe(200)
    expect(String(r.headers['content-type'])).toMatch(/application\/json/)
    expect(JSON.parse(r.body.toString('utf8'))).toEqual({ id: '42' })
  })

  it('echoes JSON request bodies via POST /echo', async () => {
    const payload = JSON.stringify({ msg: 'pong' })
    const r = await h2request(
      client,
      {
        [h2.HTTP2_HEADER_METHOD]: 'POST',
        [h2.HTTP2_HEADER_PATH]: '/echo',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
      payload,
    )
    expect(r.status).toBe(201)
    expect(JSON.parse(r.body.toString('utf8'))).toEqual({ echoed: 'pong' })
  })

  it('returns 404 with the framework error envelope for unknown routes', async () => {
    const r = await h2request(client, {
      [h2.HTTP2_HEADER_METHOD]: 'GET',
      [h2.HTTP2_HEADER_PATH]: '/does-not-exist',
    })
    expect(r.status).toBe(404)
    const body = JSON.parse(r.body.toString('utf8'))
    expect(body).toEqual({ error: 'Not Found', code: 'NOT_FOUND' })
  })

  it('strips :status / :path / :method pseudo-headers from ctx.headers', async () => {
    // Re-bind a tiny app on a separate port — we want a handler that inspects
    // ctx.headers and returns the keys, so we can assert no `:` keys leak through.
    const probeApp = new IngeniumApp({ transport: new Http2cAdapter() })
    probeApp.get('/keys', (ctx) => {
      ctx.json({ keys: Object.keys(ctx.headers) })
    })
    const probe = await probeApp.listen(0)
    const probeClient = h2connect(`http://${probe.host}:${probe.port}`)
    probeClient.on('error', () => {})

    try {
      const r = await h2request(probeClient, {
        [h2.HTTP2_HEADER_METHOD]: 'GET',
        [h2.HTTP2_HEADER_PATH]: '/keys',
        'x-custom': 'value',
      })
      expect(r.status).toBe(200)
      const { keys } = JSON.parse(r.body.toString('utf8')) as { keys: string[] }
      expect(keys.some((k) => k.startsWith(':'))).toBe(false)
      expect(keys).toContain('x-custom')
    } finally {
      await new Promise<void>((res) => probeClient.close(() => res()))
      await probe.close({ gracefulTimeoutMs: 50 })
    }
  })
})

/**
 * h2 (TLS) tests are deferred to v0.2 — they need an in-memory cert pair
 * (e.g. via `node:crypto.generateKeyPairSync` + a self-signed X.509). Skipping
 * here keeps the test suite cert-free; manual smoke testing is documented in
 * the adapter's docblock.
 */
describe.skip('Http2Adapter (h2 / TLS) — deferred to v0.2', () => {
  it('placeholder', () => {
    /* requires self-signed cert generation; see comment above */
  })
})
