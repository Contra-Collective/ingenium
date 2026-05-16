// Notes API — bootstrap.
//
// Reading order: load config → open DB → build app (logger plugin, auth
// plugin, error boundary, mount routers) → listen → register signal handlers
// for a clean shutdown. The exported `buildApp()` is reused by the
// integration tests so they can spin up real HTTP servers on ephemeral ports.

import { pathToFileURL } from 'node:url'
import {
  ingenium,
  IngeniumNotFoundError,
  IngeniumUnauthorizedError,
  IngeniumValidationError,
  type IngeniumApp,
} from 'ingenium'
import { loadConfig, type AppConfig } from './config.ts'
import { openDatabase, type DB } from './db.ts'
import { authPlugin } from './auth.ts'
import { createLogger, loggerPlugin } from './logger.ts'
import { healthRouter } from './routes/health.ts'
import { usersRouter } from './routes/users.ts'
import { notesRouter } from './routes/notes.ts'
import type { Logger } from 'pino'

export interface BuildAppOptions {
  config: AppConfig
  db: DB
  logger: Logger
}

export async function buildApp(opts: BuildAppOptions): Promise<IngeniumApp> {
  const app = ingenium()

  await app.register(loggerPlugin, { logger: opts.logger })
  await app.register(authPlugin, { db: opts.db })

  // Centralized error boundary: distinguish framework errors so clients see
  // useful status codes, but never leak stack traces. Unknowns are logged
  // with full context and surfaced as a generic 500.
  app.onError((err, ctx) => {
    if (err instanceof IngeniumValidationError) {
      ctx.json({ error: err.message, code: err.code, fields: err.fields }, 422)
      return
    }
    if (err instanceof IngeniumUnauthorizedError) {
      ctx.json({ error: err.message, code: err.code }, 401)
      return
    }
    if (err instanceof IngeniumNotFoundError) {
      ctx.json({ error: err.message, code: err.code }, 404)
      return
    }
    // Other IngeniumErrors (e.g. IngeniumBadRequestError) — honor their statusCode.
    if (err instanceof Error && 'statusCode' in err && typeof err.statusCode === 'number') {
      const code = (err as { code?: string }).code ?? 'ERROR'
      ctx.json({ error: err.message, code }, err.statusCode)
      return
    }
    // Truly unknown — log with context, return a generic message.
    ctx.log.error({ err }, 'unhandled error')
    ctx.json({ error: 'Internal Server Error', code: 'INTERNAL_ERROR' }, 500)
  })

  app.use('/api/health', healthRouter(opts.db))
  app.use('/api/users', usersRouter(opts.db))
  app.use('/api/notes', notesRouter(opts.db))

  return app
}

/** Entry-point used by `npm run dev` / `npm start`. */
async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger({ level: config.LOG_LEVEL })
  const db = openDatabase(config.DATABASE_FILE)
  const app = await buildApp({ config, db, logger })

  const server = await app.listen(config.PORT)
  logger.info(
    { port: server.port, db: config.DATABASE_FILE },
    'notes-api listening',
  )

  // Graceful shutdown. We try to use the framework's `gracefulShutdown` helper
  // if it ever gets exported; until then we wire SIGINT/SIGTERM directly.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutting down')
    try {
      await server.close({ gracefulTimeoutMs: 5_000 })
      db.close()
      logger.info('shutdown complete')
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'error during shutdown')
      process.exit(1)
    }
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

// Cross-platform entry-point detection: compare the file URL of this module
// with the file URL of the script `node`/`tsx` was invoked with.
const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('fatal:', err)
    process.exit(1)
  })
}
