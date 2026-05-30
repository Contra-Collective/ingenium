/**
 * End-to-end compatibility tests for `expressCompat`.
 *
 * These boot a real Ingenium app on an ephemeral port (NodeAdapter,
 * `app.listen(0)`) and exercise each middleware via real HTTP requests.
 *
 * Since the shims became real Node streams (`req` extends Readable, `res`
 * extends Writable/EventEmitter), the previously-"unsupported" set now works:
 *
 *  cors                — SUPPORTED  (headers + preflight)
 *  helmet              — SUPPORTED  (all default security headers)
 *  morgan              — SUPPORTED  (end-of-request tokens via res 'finish')
 *  cookie-parser       — SUPPORTED  (req.cookies → ctx.state.cookies)
 *  express-rate-limit  — SUPPORTED  (req.ip is populated; no custom keyGen)
 *  compression         — SUPPORTED  (real res.write/res.end gzip interpose)
 *  body-parser         — SUPPORTED  (real req stream; req.body → ctx.state.body)
 *  express-session     — SUPPORTED  (on-headers Set-Cookie + save-on-end)
 *  multer              — SUPPORTED  (req.pipe(busboy); req.file → ctx.state.file)
 *  res.redirect        — SUPPORTED  (unblocks passport-style redirect flows)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { get as httpGet } from 'node:http'
import { Writable } from 'node:stream'

import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bodyParser from 'body-parser'
import passport from 'passport'
import session from 'express-session'
import multer from 'multer'

import { IngeniumApp, NodeAdapter, type ListeningServer, type IngeniumContext } from 'ingenium'
import { expressCompat, type ExpressMiddleware } from '../src/index.ts'

// ───── Tiny harness ────────────────────────────────────────────────────────

interface BootedApp {
  app: IngeniumApp
  server: ListeningServer
  url: string
}

async function boot(configure: (app: IngeniumApp) => void): Promise<BootedApp> {
  const app = new IngeniumApp({ transport: new NodeAdapter() })
  configure(app)
  const server = await app.listen(0)
  return { app, server, url: `http://${server.host === '0.0.0.0' ? '127.0.0.1' : server.host}:${server.port}` }
}

async function shutdown(b: BootedApp | undefined): Promise<void> {
  if (!b) return
  await b.server.close({ gracefulTimeoutMs: 100 })
}

/** Raw GET that does NOT auto-decompress, so we can inspect gzip bytes + headers. */
function rawGet(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, { headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      )
    })
    req.on('error', reject)
  })
}

// ───── 1. cors ─────────────────────────────────────────────────────────────

describe('cors (SUPPORTED)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      app.use(expressCompat(cors() as ExpressMiddleware))
      app.get('/ping', (ctx: IngeniumContext) => ctx.json({ ok: true }))
    })
  })
  afterAll(() => shutdown(booted))

  it('sets Access-Control-Allow-Origin on a simple GET', async () => {
    const res = await fetch(`${booted.url}/ping`, { headers: { origin: 'https://example.com' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('handles OPTIONS preflight with CORS headers and 204', async () => {
    const res = await fetch(`${booted.url}/ping`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type',
      },
    })
    expect([200, 204]).toContain(res.status)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toMatch(/GET/i)
    await res.arrayBuffer()
  })
})

// ───── 2. helmet ───────────────────────────────────────────────────────────

describe('helmet (SUPPORTED)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      app.use(expressCompat(helmet() as ExpressMiddleware))
      app.get('/ping', (ctx: IngeniumContext) => ctx.json({ ok: true }))
    })
  })
  afterAll(() => shutdown(booted))

  it('sets X-Content-Type-Options and X-Frame-Options', async () => {
    const res = await fetch(`${booted.url}/ping`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBeTruthy()
  })

  it('sets Content-Security-Policy and Strict-Transport-Security', async () => {
    const res = await fetch(`${booted.url}/ping`)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(res.headers.get('strict-transport-security')).toBeTruthy()
    await res.arrayBuffer()
  })
})

// ───── 3. morgan (now logs end-of-request tokens via res 'finish') ──────────

describe('morgan (SUPPORTED — :status fires on finish)', () => {
  let booted: BootedApp
  let logged: string[] = []

  beforeAll(async () => {
    logged = []
    const stream = new Writable({
      write(chunk, _enc, cb) {
        logged.push(String(chunk))
        cb()
      },
    })
    // ':status' depends on res.on('finish') — which the real Writable shim now
    // emits. No `immediate: true` needed.
    booted = await boot((app) => {
      app.use(expressCompat(morgan(':method :url :status', { stream }) as unknown as ExpressMiddleware))
      app.get('/log-me', (ctx: IngeniumContext) => ctx.json({ ok: true }))
    })
  })
  afterAll(() => shutdown(booted))

  it('writes method, url AND status to the captured stream', async () => {
    const res = await fetch(`${booted.url}/log-me`)
    expect(res.status).toBe(200)
    await res.arrayBuffer()
    await new Promise((r) => setTimeout(r, 50))
    const all = logged.join('')
    expect(all).toContain('GET')
    expect(all).toContain('/log-me')
    // The end-of-request token now renders the real status, not '-'.
    expect(all).toMatch(/\/log-me 200/)
  })
})

// ───── 4. compression (now interposes a real gzip stream) ───────────────────

describe('compression (SUPPORTED)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      app.use(expressCompat(compression({ threshold: 0 }) as unknown as ExpressMiddleware))
      app.get('/big', (ctx: IngeniumContext) => ctx.json({ data: 'x'.repeat(2048) }))
    })
  })
  afterAll(() => shutdown(booted))

  it('gzips /big when Accept-Encoding: gzip', async () => {
    const res = await rawGet(`${booted.url}/big`, { 'accept-encoding': 'gzip' })
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    const decoded = JSON.parse(gunzipSync(res.body).toString('utf8')) as { data: string }
    expect(decoded.data.length).toBe(2048)
  })
})

// ───── 5. cookie-parser ────────────────────────────────────────────────────

describe('cookie-parser (SUPPORTED)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      app.use(expressCompat(cookieParser() as unknown as ExpressMiddleware))
      app.get('/cookies', (ctx: IngeniumContext) => {
        const cookies = ctx.state['cookies'] as Record<string, string> | undefined
        ctx.json({ session: cookies?.session ?? null, theme: cookies?.theme ?? null })
      })
    })
  })
  afterAll(() => shutdown(booted))

  it('parses Cookie header and exposes via ctx.state.cookies', async () => {
    const res = await fetch(`${booted.url}/cookies`, {
      headers: { cookie: 'session=abc123; theme=dark' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: string; theme: string }
    expect(body.session).toBe('abc123')
    expect(body.theme).toBe('dark')
  })
})

// ───── 6. express-rate-limit (now works without a custom keyGenerator) ──────

describe('express-rate-limit (SUPPORTED — req.ip populated)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    const limiter = rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: true,
      legacyHeaders: false,
    })
    booted = await boot((app) => {
      app.use(expressCompat(limiter as unknown as ExpressMiddleware))
      app.get('/limited', (ctx: IngeniumContext) => ctx.json({ ok: true }))
    })
  })
  afterAll(() => shutdown(booted))

  it('returns 429 after the limit is exceeded', async () => {
    const r1 = await fetch(`${booted.url}/limited`)
    await r1.arrayBuffer()
    const r2 = await fetch(`${booted.url}/limited`)
    await r2.arrayBuffer()
    const r3 = await fetch(`${booted.url}/limited`)
    await r3.arrayBuffer()

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(r3.status).toBe(429)
    expect(r3.headers.get('ratelimit-limit')).toBe('2')
  })
})

// ───── 7. body-parser (now reads the real request stream) ───────────────────

describe('body-parser (SUPPORTED)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      app.use(expressCompat(bodyParser.json() as unknown as ExpressMiddleware))
      app.post('/echo', (ctx: IngeniumContext) => ctx.json({ got: ctx.state['body'] }))
    })
  })
  afterAll(() => shutdown(booted))

  it('populates req.body with parsed JSON (mirrored to ctx.state.body)', async () => {
    const res = await fetch(`${booted.url}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hi: 'there' }),
    })
    expect(res.status).toBe(200)
    const out = (await res.json()) as { got: { hi: string } }
    expect(out.got.hi).toBe('there')
  })
})

// ───── 8. passport.initialize + res.redirect ────────────────────────────────

describe('passport.initialize (SUPPORTED) and res.redirect', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      app.use(expressCompat(passport.initialize() as unknown as ExpressMiddleware))
      app.get('/who', (ctx: IngeniumContext) =>
        ctx.json({ hasPassport: ctx.state['_passport'] !== undefined }),
      )
      // res.redirect is the surface passport strategies finish through.
      app.get('/go', (ctx: IngeniumContext) => {
        const mw = expressCompat(((_req, res) => res.redirect('/landing')) as ExpressMiddleware)
        return mw(ctx, async () => {})
      })
    })
  })
  afterAll(() => shutdown(booted))

  it('passport.initialize() runs and propagates _passport to ctx.state', async () => {
    const res = await fetch(`${booted.url}/who`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { hasPassport: boolean }
    expect(body.hasPassport).toBe(true)
  })

  it('res.redirect sets Location and a 3xx status', async () => {
    const res = await fetch(`${booted.url}/go`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/landing')
    await res.arrayBuffer()
  })
})

// ───── 9. express-session (now persists via Set-Cookie + save-on-end) ───────

describe('express-session (SUPPORTED)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      app.use(
        expressCompat(
          session({ secret: 'test', resave: false, saveUninitialized: true }) as unknown as ExpressMiddleware,
        ),
      )
      app.get('/s', (ctx: IngeniumContext) => {
        const sess = ctx.state['session'] as { views?: number } | undefined
        const views = (sess?.views ?? 0) + 1
        if (sess) sess.views = views
        ctx.json({ views })
      })
    })
  })
  afterAll(() => shutdown(booted))

  it('writes a Set-Cookie with connect.sid', async () => {
    const res = await fetch(`${booted.url}/s`)
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/connect\.sid=/)
    await res.arrayBuffer()
  })
})

// ───── 10. multer (now owns the real request stream) ────────────────────────

describe('multer (SUPPORTED)', () => {
  let booted: BootedApp
  beforeAll(async () => {
    booted = await boot((app) => {
      const upload = multer({ storage: multer.memoryStorage() })
      app.use(expressCompat(upload.single('file') as unknown as ExpressMiddleware))
      app.post('/upload', (ctx: IngeniumContext) => {
        const file = ctx.state['file'] as { size?: number; originalname?: string } | undefined
        ctx.json({ size: file?.size ?? null, name: file?.originalname ?? null })
      })
    })
  })
  afterAll(() => shutdown(booted))

  it('parses a multipart upload into req.file (mirrored to ctx.state.file)', async () => {
    const fd = new FormData()
    fd.set('file', new Blob([new Uint8Array([1, 2, 3])]), 'tiny.bin')
    const res = await fetch(`${booted.url}/upload`, { method: 'POST', body: fd })
    expect(res.status).toBe(200)
    const out = (await res.json()) as { size: number; name: string }
    expect(out.size).toBe(3)
    expect(out.name).toBe('tiny.bin')
  })
})
