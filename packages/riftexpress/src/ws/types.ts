/**
 * Public types for the optional WebSocket adapter. The `ws` package is an
 * OPTIONAL peer dependency — these types are erased at runtime, so this file
 * compiles even when `ws` is not installed.
 */

import type { IncomingMessage } from 'node:http'
// Type-only — TypeScript erases this; safe even without `ws` installed.
import type { WebSocket as WsWebSocket } from 'ws'
import type { RiftexContext } from '../context/context.ts'

/** Re-export the underlying `ws` `WebSocket` type for convenience. */
export type WebSocket = WsWebSocket

/**
 * Handler invoked when a client successfully upgrades to a WebSocket.
 *
 * `socket` is the `ws.WebSocket` instance. `ctx` is a minimal `RiftexContext`
 * populated from the upgrade `IncomingMessage` — the body / response writers
 * are not meaningful for WS handlers (the upgrade has already happened).
 */
export type WebSocketHandler = (socket: WsWebSocket, ctx: RiftexContext) => void | Promise<void>

/** Per-handler options forwarded to `WebSocketServer({ noServer: true, ... })`. */
export interface WebSocketHandlerOptions {
  /** Max payload size (bytes) for incoming frames. */
  maxPayload?: number
  /** Enable permessage-deflate. Defaults to false (matches `ws` default). */
  perMessageDeflate?: boolean
}

/** Internal: a registered handler entry. */
export interface WsRoute {
  path: string
  handler: WebSocketHandler
  options: WebSocketHandlerOptions
}

/** Bag passed to integrators (advanced). */
export interface WsIntegrator {
  (httpServer: import('node:http').Server): void
}

/** Shape of the per-app registrar exposed to `enableWebSockets`. */
export interface WsRegistrar {
  add(path: string, handler: WebSocketHandler, options?: WebSocketHandlerOptions): void
  attach(httpServer: import('node:http').Server): void
  close(): Promise<void>
}

/** Re-export so consumers can build minimal contexts in tests. */
export type { IncomingMessage }
