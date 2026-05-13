import { describe, it, expect, vi, afterEach } from 'vitest'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { NodeAdapter } from '../src/transport/node.ts'
import { gracefulShutdown } from '../src/transport/shutdown.ts'
import { RiftexContext } from '../src/context/context.ts'
import type { ListeningServer, TransportHooks } from '../src/transport/types.ts'

/**
 * Spin up a NodeAdapter bound to an ephemeral port with the given dispatch
 * behavior. Returns the listening handle so the test can drive it.
 */
async function startServer(
  dispatch: (ctx: RiftexContext) => Promise<void>,
): Promise<ListeningServer> {
  const adapter = new NodeAdapter()
  const hooks: TransportHooks = {
    acquire: () => new RiftexContext(),
    release: () => {
      /* no-op for tests */
    },
    dispatch,
  }
  adapter.attach(hooks)
  return adapter.listen(0, '127.0.0.1')
}

/** Hit GET / on the given server and return the response object once headers arrive. */
function getRequest(server: ListeningServer): { req: ReturnType<typeof httpRequest>; res: Promise<IncomingMessage> } {
  const req = httpRequest({ host: server.host, port: server.port, method: 'GET', path: '/' })
  const res = new Promise<IncomingMessage>((resolve, reject) => {
    req.once('response', resolve)
    req.once('error', reject)
  })
  req.end()
  return { req, res }
}

describe('NodeAdapter close()', () => {
  it('close() with no args stops the server cleanly', async () => {
    const server = await startServer(async (ctx) => {
      ctx.json({ ok: true })
    })

    // Make one request, fully drain it, then close.
    const { res } = getRequest(server)
    const response = await res
    response.resume()
    await new Promise<void>((resolve) => response.once('end', resolve))

    await expect(server.close()).resolves.toBeUndefined()
  })

  it('close({ gracefulTimeoutMs }) destroys lingering sockets when the timeout elapses', async () => {
    // Handler that never resolves — keeps the connection pinned open.
    let dispatchStarted: (() => void) | null = null
    const dispatched = new Promise<void>((resolve) => {
      dispatchStarted = resolve
    })

    const server = await startServer(async (_ctx) => {
      dispatchStarted?.()
      // Stall forever — close() must force-kill us.
      await new Promise(() => {
        /* never resolves */
      })
    })

    const { req, res } = getRequest(server)
    // Wait until the handler has been invoked, so we know the socket exists.
    await dispatched

    const start = Date.now()
    await server.close({ gracefulTimeoutMs: 100 })
    const elapsed = Date.now() - start

    // Should have force-closed shortly after 100ms — give plenty of slack
    // for slow CI but assert it did NOT hang for the full default timeout.
    expect(elapsed).toBeLessThan(2_000)
    expect(elapsed).toBeGreaterThanOrEqual(50)

    // The pending request's socket should have been destroyed; either the
    // response errors or the request emits an error. Either way it does
    // not hang.
    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        resolve()
      }
      req.once('error', finish)
      res.then((response) => {
        response.once('close', finish)
        response.once('end', finish)
        response.resume()
      }).catch(finish)
      // Belt-and-suspenders: don't let a missed event hang the test.
      setTimeout(finish, 1_000).unref()
    })
  })
})

describe('gracefulShutdown', () => {
  // Each test installs and removes its own listeners; track baselines per-test.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles the configured signal: closes server and runs onShutdown', async () => {
    const server = await startServer(async (ctx) => {
      ctx.json({ ok: true })
    })

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never)
    const closeSpy = vi.spyOn(server, 'close')
    const onShutdown = vi.fn(async () => {
      /* user cleanup */
    })

    const unsubscribe = gracefulShutdown(server, {
      signals: ['SIGUSR2'],
      onShutdown,
      logger: () => {
        /* silence */
      },
    })

    process.emit('SIGUSR2')

    // Wait for the async shutdown chain to finish (onShutdown + close + exit).
    // exit is stubbed, so we poll until it has been called.
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalled()
    })

    expect(onShutdown).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy.mock.calls[0]?.[0]).toMatchObject({ gracefulTimeoutMs: expect.any(Number) })
    expect(exitSpy).toHaveBeenCalledWith(0)

    unsubscribe()
    // The server may already be closed (close was called). Ignore errors.
    await server.close().catch(() => undefined)
  })

  it('returns an unsubscribe function that removes the signal listeners', async () => {
    const server = await startServer(async (ctx) => {
      ctx.json({ ok: true })
    })

    const baseline = process.listenerCount('SIGUSR2')

    const unsubscribe = gracefulShutdown(server, {
      signals: ['SIGUSR2'],
      logger: () => {
        /* silence */
      },
    })

    expect(process.listenerCount('SIGUSR2')).toBe(baseline + 1)

    unsubscribe()

    expect(process.listenerCount('SIGUSR2')).toBe(baseline)

    await server.close()
  })
})
