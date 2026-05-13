import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { riftex } from '../src/index.ts'
import type { ListeningServer } from '../src/transport/types.ts'

function url(server: ListeningServer, path: string): string {
  return `http://127.0.0.1:${server.port}${path}`
}

describe('e2e trustProxy: "loopback" honors X-Forwarded-For', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = riftex({ trustProxy: 'loopback' })
    app.get('/whoami', (ctx) => ({ ip: ctx.ip, ips: ctx.ips, remote: ctx.remoteAddress }))
    server = await app.listen(0, '127.0.0.1')
  })
  afterAll(() => server.close())

  it('uses XFF when peer is loopback (trusted)', async () => {
    const res = await fetch(url(server, '/whoami'), {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ip: string; ips: string[]; remote: string }
    expect(body.ip).toBe('1.2.3.4')
    // Full chain includes the immediate peer at the end.
    expect(body.ips[0]).toBe('1.2.3.4')
    // Loopback peer — Node may report 127.0.0.1 or ::ffff:127.0.0.1.
    expect(body.remote === '127.0.0.1' || body.remote === '::ffff:127.0.0.1' || body.remote === '::1').toBe(
      true,
    )
  })

  it('falls back to loopback peer when XFF absent', async () => {
    const res = await fetch(url(server, '/whoami'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ip: string; remote: string }
    // No XFF → ip is the immediate peer (which IS loopback, but the chain
    // starts and ends with it, so resolution returns loopback as the client).
    expect(body.ip).toBe(body.remote)
    expect(
      body.ip === '127.0.0.1' || body.ip === '::ffff:127.0.0.1' || body.ip === '::1',
    ).toBe(true)
  })
})

describe('e2e trustProxy: false (default) ignores X-Forwarded-For', () => {
  let server: ListeningServer
  beforeAll(async () => {
    const app = riftex() // trustProxy defaults to false
    app.get('/whoami', (ctx) => ({ ip: ctx.ip, remote: ctx.remoteAddress }))
    server = await app.listen(0, '127.0.0.1')
  })
  afterAll(() => server.close())

  it('returns the loopback peer even when XFF is set', async () => {
    const res = await fetch(url(server, '/whoami'), {
      headers: { 'x-forwarded-for': '9.9.9.9' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ip: string; remote: string }
    expect(body.ip).toBe(body.remote)
    expect(
      body.ip === '127.0.0.1' || body.ip === '::ffff:127.0.0.1' || body.ip === '::1',
    ).toBe(true)
    // Definitely NOT the spoofed XFF value.
    expect(body.ip).not.toBe('9.9.9.9')
  })
})
