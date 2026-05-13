// Pino logger + a RiftExpress plugin that decorates every ctx with a
// per-request child logger and emits structured request/response lines via
// the framework's `onRequest` / `onResponse` hooks.

import { randomUUID } from 'node:crypto'
import { pino, type Logger } from 'pino'
import type { RiftexPlugin } from 'riftexpress'

declare module 'riftexpress' {
  interface RiftexContext {
    /** Per-request child logger. Includes `reqId`, `method`, `path`. */
    log: Logger
    /** Wall-clock start time (ms since epoch) — used to compute response latency. */
    startedAt: number
  }
}

export interface LoggerPluginOpts {
  level: pino.Level
  /** Set false in tests to silence output without changing log structure. */
  enabled?: boolean
}

/** Build a base pino instance. Kept separate so tests can inject a silent one. */
export function createLogger(opts: LoggerPluginOpts): Logger {
  return pino({
    level: opts.enabled === false ? 'silent' : opts.level,
    base: undefined, // drop default pid/hostname noise
    timestamp: pino.stdTimeFunctions.isoTime,
  })
}

export const loggerPlugin: RiftexPlugin<{ logger: Logger }> = (app, opts) => {
  const root = opts.logger

  // Eager: cheap, every request reads `reqId` for downstream correlation.
  app.decorateRequest('startedAt', () => Date.now())
  app.decorateRequest('log', (ctx) =>
    root.child({ reqId: randomUUID(), method: ctx.method, path: ctx.path }),
  )

  app.hooks.onRequest((ctx) => {
    ctx.log.debug('request received')
  })

  app.hooks.onResponse((ctx) => {
    // `_statusCode` is technically @internal in RiftexContext but it's the only
    // way today to observe the resolved response status from a hook. Adding
    // a public `ctx.statusCode` getter would let us drop this cast.
    const status = (ctx as unknown as { _statusCode: number })._statusCode
    ctx.log.info({ status, durMs: Date.now() - ctx.startedAt }, 'request completed')
  })
}
