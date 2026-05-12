/**
 * Graceful shutdown helper. Wires POSIX signal handlers to drain a
 * {@link ListeningServer}, run a user cleanup hook, then exit.
 *
 * Most production deployments (Kubernetes, systemd, PM2, ECS, Fly, …) send
 * SIGTERM when they want a process to stop. By default Node simply dies on
 * SIGTERM, which kills in-flight requests and leaves keep-alive sockets
 * dangling. Calling {@link gracefulShutdown} after `app.listen()` opts the
 * process into a clean drain instead.
 */

import type { ListeningServer } from './types.ts'

/** Options for {@link gracefulShutdown}. */
export interface ShutdownOptions {
  /**
   * Maximum time (ms) to wait for sockets to drain before they are forcibly
   * destroyed. Defaults to `10_000` (10s) — matches Kubernetes' default
   * `terminationGracePeriodSeconds` headroom.
   */
  gracefulTimeoutMs?: number

  /**
   * Signals to listen for. Defaults to `['SIGTERM', 'SIGINT']`.
   */
  signals?: NodeJS.Signals[]

  /**
   * User cleanup hook — runs AFTER the server stops accepting new
   * connections but BEFORE the process exits. Use for closing DB pools,
   * flushing logs, etc. Awaited; throwing exits with code 1.
   */
  onShutdown?: () => void | Promise<void>

  /** Logger used to announce shutdown lifecycle events. Defaults to `console.log`. */
  logger?: (msg: string) => void
}

/**
 * Wire signal handlers that gracefully shut down `server` on SIGTERM/SIGINT
 * (or whichever signals you pass). Returns an unsubscribe function that
 * removes the listeners — mostly useful for tests.
 *
 * @example
 *   const server = await app.listen(3000)
 *   gracefulShutdown(server, { onShutdown: async () => db.close() })
 */
export function gracefulShutdown(
  server: ListeningServer,
  opts: ShutdownOptions = {},
): () => void {
  const gracefulTimeoutMs = opts.gracefulTimeoutMs ?? 10_000
  const signals: NodeJS.Signals[] = opts.signals ?? ['SIGTERM', 'SIGINT']
  const log = opts.logger ?? ((msg: string) => console.log(msg))

  let shuttingDown = false

  const handler = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      // Second signal during an in-progress drain → bail immediately.
      log(`riftexpress: received ${signal} during shutdown — forcing exit`)
      process.exit(1)
      return
    }
    shuttingDown = true
    log(`riftexpress: received ${signal}, shutting down (timeout ${gracefulTimeoutMs}ms)`)

    void (async () => {
      try {
        if (opts.onShutdown) await opts.onShutdown()
        await server.close({ gracefulTimeoutMs })
        log('riftexpress: shutdown complete')
        process.exit(0)
      } catch (err) {
        log(`riftexpress: shutdown failed: ${(err as Error)?.message ?? String(err)}`)
        process.exit(1)
      }
    })()
  }

  for (const signal of signals) process.on(signal, handler)

  return (): void => {
    for (const signal of signals) process.off(signal, handler)
  }
}
