/**
 * WebSocket registrar — the small piece of state that holds path → handler
 * mappings and knows how to wire `'upgrade'` on a Node `http.Server`.
 *
 * Design: the `ws` package is loaded lazily via dynamic `import('ws')` so
 * apps that never use WebSockets pay no cost (no module load, no peer-dep
 * requirement). The first call to `attach()` resolves the import.
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { RexContext } from '../context/context.ts'
import type { HttpMethod } from '../router/types.ts'
import type {
  WebSocketHandler,
  WebSocketHandlerOptions,
  WsRegistrar,
  WsRoute,
} from './types.ts'

/**
 * Attempt to detect whether `ws` is installed. Used by the test suite to
 * `describe.skipIf` the WS suite when the optional peer dep is missing.
 */
export async function peerHasWs(): Promise<boolean> {
  try {
    await import('ws')
    return true
  } catch {
    return false
  }
}

/**
 * Build a registrar bound to an app. The registrar is intentionally
 * decoupled from `RexApp` — the app calls `add()` from `app.ws()`, and
 * `enableWebSockets()` (or the app's `listen()` integration) calls `attach()`
 * once the underlying `http.Server` is created.
 */
export function createWebSocketRegistrar(): WsRegistrar {
  const routes: Map<string, WsRoute> = new Map()
  let attachedServer: HttpServer | null = null
  // The `ws` `WebSocketServer` instance, lazy-initialized on first upgrade.
  // We use one server per registered path so per-handler options apply.
  const wssByPath: Map<string, unknown> = new Map()
  // We keep a reference to the `ws` module after the first dynamic import.
  let wsModule: typeof import('ws') | null = null

  // Single shared upgrade listener — installed exactly once.
  let upgradeListener: ((req: IncomingMessage, socket: Socket, head: Buffer) => void) | null = null

  function add(path: string, handler: WebSocketHandler, options: WebSocketHandlerOptions = {}): void {
    if (routes.has(path)) {
      throw new Error(`riftexpress.ws: path "${path}" already has a WebSocket handler`)
    }
    routes.set(path, { path, handler, options })
  }

  function attach(httpServer: HttpServer): void {
    if (attachedServer === httpServer) return // idempotent
    if (attachedServer !== null) {
      throw new Error('riftexpress.ws: registrar already attached to a different http.Server')
    }
    attachedServer = httpServer

    upgradeListener = (req, socket, head) => {
      // Parse the path from the upgrade request URL. We only look at the
      // pathname — query strings are exposed via `ctx.rawQuery` for handlers
      // that care.
      const url = req.url ?? '/'
      const qIdx = url.indexOf('?')
      const path = qIdx >= 0 ? url.slice(0, qIdx) : url

      const route = routes.get(path)
      if (!route) {
        // No handler for this path — close the socket cleanly. The
        // 404-equivalent for WebSockets is just refusing the upgrade.
        socket.destroy()
        return
      }

      // Lazy-load `ws`. On the first upgrade, dynamically import. If `ws`
      // isn't installed, give a clear actionable error and tear the socket
      // down — apps that wired `app.ws(...)` without installing the peer
      // dep should learn about it the moment a client tries to connect.
      void (async () => {
        try {
          if (wsModule === null) wsModule = await import('ws')
        } catch (err) {
          process.emitWarning(
            'riftexpress: app.ws() was called but the `ws` package is not installed. ' +
              'Install it with `npm install ws` (and `@types/ws` for TypeScript).',
          )
          socket.destroy()
          return
        }

        let wss = wssByPath.get(route.path) as
          | InstanceType<typeof import('ws').WebSocketServer>
          | undefined
        if (!wss) {
          wss = new wsModule.WebSocketServer({
            noServer: true,
            maxPayload: route.options.maxPayload,
            perMessageDeflate: route.options.perMessageDeflate ?? false,
          })
          wssByPath.set(route.path, wss)
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          const ctx = buildMinimalContext(req, path)
          try {
            const ret = route.handler(ws, ctx)
            if (ret && typeof (ret as Promise<unknown>).then === 'function') {
              ;(ret as Promise<unknown>).catch((err) => {
                process.emitWarning(
                  `riftexpress.ws: handler for ${path} rejected: ${(err as Error)?.message ?? String(err)}`,
                )
                try { ws.close(1011, 'handler error') } catch { /* socket may already be dead */ }
              })
            }
          } catch (err) {
            process.emitWarning(
              `riftexpress.ws: handler for ${path} threw: ${(err as Error)?.message ?? String(err)}`,
            )
            try { ws.close(1011, 'handler error') } catch { /* ignore */ }
          }
        })
      })()
    }

    httpServer.on('upgrade', upgradeListener)
  }

  async function close(): Promise<void> {
    // Detach the upgrade listener so a re-listen on the same server doesn't
    // double-up handlers.
    if (attachedServer && upgradeListener) {
      attachedServer.off('upgrade', upgradeListener)
    }
    upgradeListener = null
    attachedServer = null

    // Close every per-path WebSocketServer. `ws.WebSocketServer.close(cb)`
    // fires once all clients have disconnected; we await each in parallel.
    const closes: Promise<void>[] = []
    for (const wss of wssByPath.values()) {
      const server = wss as InstanceType<typeof import('ws').WebSocketServer>
      // Forcibly terminate any still-open clients so close() resolves
      // promptly during test teardown.
      for (const client of server.clients) {
        try { client.terminate() } catch { /* ignore */ }
      }
      closes.push(new Promise<void>((resolve) => server.close(() => resolve())))
    }
    wssByPath.clear()
    await Promise.all(closes)
  }

  return { add, attach, close }
}

/**
 * Build a minimal `RexContext` for a WebSocket handler. We don't run the
 * full request pipeline (no middleware, no decorators) because the upgrade
 * has already taken place — the handler owns the socket from here.
 */
function buildMinimalContext(req: IncomingMessage, path: string): RexContext {
  const ctx = new RexContext()
  ctx.method = (req.method ?? 'GET') as HttpMethod
  ctx.url = req.url ?? '/'
  ctx.path = path
  const url = ctx.url
  const qIdx = url.indexOf('?')
  ctx.rawQuery = qIdx >= 0 ? url.slice(qIdx + 1) : ''
  ctx.headers = req.headers
  return ctx
}
