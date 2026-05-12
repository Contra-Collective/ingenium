/**
 * RiftExpress — Express DX, Hono/Fastify throughput.
 *
 * @packageDocumentation
 */

import { makeRexFactory, type RexFactory } from './app.ts'
import { jsonMiddleware, urlencodedMiddleware } from './body/middleware.ts'
import { staticMiddleware } from './static/middleware.ts'
import { corsMiddleware } from './cors/middleware.ts'
import { sse } from './sse/sse.ts'
import { rateLimit } from './rate-limit/middleware.ts'

// ───── App + Router ────────────────────────────────────────────────────────
export { RexApp, type RexAppOptions, type RexErrorHandler } from './app.ts'
export { Router } from './router/router.ts'

// ───── Context + Body ──────────────────────────────────────────────────────
export { RexContext, type ResponseBody } from './context/context.ts'
export { RexBody, type ParseSchema, type SafeParseSchema } from './context/body.ts'
export { RexContextPool } from './context/pool.ts'
export type {
  MultipartFile,
  MultipartOptions,
  MultipartResult,
} from './body/multipart-types.ts'

// ───── Standard Schema (https://standardschema.dev) ────────────────────────
export {
  isStandardSchema,
  type StandardSchemaV1,
  type StandardResult,
  type StandardIssue,
  type StandardPathSegment,
  type StandardSuccessResult,
  type StandardFailureResult,
  type StandardSchemaV1Props,
} from './schema/standard.ts'

// ───── Middleware + Handler types ──────────────────────────────────────────
export type { RexMiddleware, RexHandler, ComposedHandler } from './middleware/types.ts'
export { compose, composeWithHandler } from './middleware/compose.ts'

// ───── Router types ────────────────────────────────────────────────────────
export type { HttpMethod, ExtractParams } from './router/types.ts'
export { HTTP_METHODS } from './router/types.ts'
export { RouterTrie, TrieNode, type MatchResult, type MatchMiss } from './router/trie.ts'

// ───── Static-file middleware ──────────────────────────────────────────────
export { staticMiddleware as static_ } from './static/middleware.ts'
export type { StaticOptions } from './static/types.ts'

// ───── CORS middleware ─────────────────────────────────────────────────────
export { corsMiddleware as cors_ } from './cors/middleware.ts'
export type { CorsOptions, CorsOrigin, CorsOriginFn } from './cors/types.ts'

// ───── Errors ──────────────────────────────────────────────────────────────
export {
  RexError,
  RexNotFoundError,
  RexUnauthorizedError,
  RexMethodNotAllowedError,
  RexPayloadTooLargeError,
  RexValidationError,
  RexBadRequestError,
} from './errors.ts'

// ───── Transport (mainly for advanced users / tests) ───────────────────────
export type { Transport, TransportHooks, ListeningServer, CloseOptions } from './transport/types.ts'
export { NodeAdapter } from './transport/node.ts'
export { Http2Adapter, Http2cAdapter, type Http2AdapterOptions } from './transport/http2.ts'
export { gracefulShutdown, type ShutdownOptions } from './transport/shutdown.ts'

// ───── Trust-proxy ─────────────────────────────────────────────────────────
export { resolveForwarded, type TrustProxy, type ForwardedInfo } from './proxy/trust.ts'

// ───── Server-Sent Events helper ───────────────────────────────────────────
export { sse, type SseStream, type SseEvent } from './sse/sse.ts'
export { startKeepAlive } from './sse/keep-alive.ts'

// ───── Rate-limit middleware ───────────────────────────────────────────────
export { rateLimit } from './rate-limit/middleware.ts'
export { MemoryStore as RateLimitMemoryStore } from './rate-limit/store.ts'
export type { RateLimitOptions, RateLimitStore } from './rate-limit/types.ts'

// ───── Session middleware ──────────────────────────────────────────────────
export { sessionMiddleware } from './session/middleware.ts'
export { MemoryStore as SessionMemoryStore } from './session/store-memory.ts'
export type {
  Session,
  SessionOptions,
  SessionStore,
  SessionCookieOptions,
} from './session/types.ts'

// ───── WebSocket adapter (optional `ws` peer dep) ──────────────────────────
export {
  enableWebSockets,
  createWebSocketRegistrar,
  peerHasWs,
  WsNodeAdapter,
  type EnableWebSocketsOptions,
  type WebSocketHandler,
  type WebSocketHandlerOptions,
  type WsIntegrator,
  type WsRegistrar,
  type WebSocket,
} from './ws/index.ts'

// ───── Plugin system ───────────────────────────────────────────────────────
export type {
  RexPlugin,
  Hooks,
  RegistrationEvent,
  Decorator,
  LazyDecorator,
  EagerDecorator,
  OnRouteHook,
  OnComposeHook,
  OnRequestHook,
  OnResponseHook,
  OnErrorHook,
} from './plugin/types.ts'
export { HooksRegistry } from './plugin/hooks.ts'
export { DecoratorRegistry } from './plugin/decorators.ts'

// ───── Default factory + body parsers ──────────────────────────────────────

/**
 * Create a new RiftExpress application.
 *
 * @example
 * import { rex } from 'riftexpress'
 *
 * const app = rex()
 * app.get('/', (ctx) => ({ hello: 'world' }))
 * await app.listen(3000)
 */
const rexCore: RexFactory = makeRexFactory()

/**
 * The `rex` export is callable AND has static helpers attached:
 *
 * - `rex(opts?)` — create an app
 * - `rex.Router()` — create a mountable router
 * - `rex.json(opts?)` — Express-compat body-parser shim (no-op; parsing is lazy)
 * - `rex.urlencoded(opts?)` — same, for `application/x-www-form-urlencoded`
 * - `rex.static(root, opts?)` — serve files from a directory
 * - `rex.cors(opts?)` — CORS middleware (simple + preflight)
 */
export const rex = Object.assign(rexCore, {
  json: jsonMiddleware,
  urlencoded: urlencodedMiddleware,
  static: staticMiddleware,
  cors: corsMiddleware,
  sse,
  rateLimit,
})

export default rex
