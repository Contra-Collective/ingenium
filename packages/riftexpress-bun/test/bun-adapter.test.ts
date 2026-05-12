import { describe, expect, it } from 'vitest'
import { rex } from 'riftexpress'
import { BunAdapter } from '../src/index.ts'

// The adapter cannot run without the Bun runtime — skip the entire suite
// when executed under plain Node so CI passes on both runtimes.
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

describe.skipIf(!hasBun)('BunAdapter', () => {
  async function bootApp() {
    const app = rex({ transport: new BunAdapter() })

    app.get('/hello', () => ({ hello: 'world' }))

    app.get('/users/:id', (ctx) => ({ id: ctx.params.id }))

    app.post('/echo', async (ctx) => {
      const body = await ctx.body.json<Record<string, unknown>>()
      return body
    })

    app.get('/boom', () => {
      throw new Error('kaboom')
    })

    const server = await app.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${server.port}`
    return { server, base }
  }

  it('responds to a simple JSON route', async () => {
    const { server, base } = await bootApp()
    try {
      const res = await fetch(`${base}/hello`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ hello: 'world' })
    } finally {
      await server.close()
    }
  })

  it('extracts route params', async () => {
    const { server, base } = await bootApp()
    try {
      const res = await fetch(`${base}/users/42`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id: '42' })
    } finally {
      await server.close()
    }
  })

  it('echoes a JSON body', async () => {
    const { server, base } = await bootApp()
    try {
      const res = await fetch(`${base}/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1, b: 'two' }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ a: 1, b: 'two' })
    } finally {
      await server.close()
    }
  })

  it('returns 404 for unknown routes', async () => {
    const { server, base } = await bootApp()
    try {
      const res = await fetch(`${base}/nope`)
      expect(res.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('serializes errors via the default error boundary', async () => {
    const { server, base } = await bootApp()
    try {
      const res = await fetch(`${base}/boom`)
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBeDefined()
    } finally {
      await server.close()
    }
  })
})
