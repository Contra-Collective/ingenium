import { describe, it, expect } from 'vitest'
import { rex } from '../src/index.ts'

/** Wait `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('e2e graceful shutdown', () => {
  it(
    'force-closes a slow request after gracefulTimeoutMs and refuses new connections',
    async () => {
      const app = rex()
      app.get('/slow', async () => {
        await delay(200)
        return { ok: true }
      })
      const server = await app.listen(0, '127.0.0.1')
      const url = `http://127.0.0.1:${server.port}/slow`

      // Kick off a slow request — handler awaits 200ms before responding.
      // Use AbortController so that, if the socket is destroyed, fetch can
      // surface the error promptly without hanging indefinitely.
      const slowReq = fetch(url).then(
        (res) => ({ ok: true as const, status: res.status }),
        (err: Error) => ({ ok: false as const, error: err }),
      )

      // Give the request a moment to actually arrive at the server before we
      // ask it to shut down.
      await delay(20)

      // Close with a tight timeout — the slow handler is still 180ms away
      // from finishing, so the socket should be force-destroyed.
      const closed = server.close({ gracefulTimeoutMs: 50 })

      // The slow request should fail (socket destroyed mid-flight) rather
      // than complete cleanly.
      const slowResult = await slowReq

      // close() must resolve (the force-close timer destroyed the socket,
      // which lets server.close()'s callback fire).
      await expect(closed).resolves.toBeUndefined()

      expect(slowResult.ok).toBe(false)

      // Fresh fetches should now fail — the server is down.
      const freshErr = await fetch(url).then(
        () => null,
        (err: Error) => err,
      )
      expect(freshErr).toBeInstanceOf(Error)
    },
    10_000,
  )
})
