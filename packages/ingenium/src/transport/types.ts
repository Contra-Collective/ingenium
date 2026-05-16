import type { IngeniumContext } from '../context/context.ts'

/** A function the framework hands to the transport — call it per request. */
export type TransportDispatch = (ctx: IngeniumContext) => Promise<void>

/** A function the transport calls to acquire a context from the pool. */
export type TransportAcquire = () => IngeniumContext

/** A function the transport calls to release a context back to the pool. */
export type TransportRelease = (ctx: IngeniumContext) => void

/**
 * The hooks a transport uses to interact with the framework. The transport
 * owns the request/response objects from its underlying server (node:http,
 * Bun.serve, etc.), populates a `IngeniumContext` from each request, awaits the
 * `dispatch` callback, then writes the context's response state to the wire.
 */
export interface TransportHooks {
  acquire: TransportAcquire
  release: TransportRelease
  dispatch: TransportDispatch
  /**
   * Hard ceiling (bytes) on the total request body. Adapters SHOULD wrap the
   * inbound body stream in `createByteLimit(maxRequestBytes)` before handing
   * it to `ctx.body._attach(...)`, AND reject with a 413 immediately when
   * the request advertises a `Content-Length` greater than this value (no
   * need to read the body). `Number.POSITIVE_INFINITY` disables the cap.
   *
   * Optional for backward compatibility with adapters / test fixtures that
   * predate this hook. The framework's `app.listen()` always populates the
   * field (default 2 MiB); consumers that read it should treat `undefined`
   * as "no cap" (`Number.POSITIVE_INFINITY`).
   */
  maxRequestBytes?: number
}

/** Options accepted by {@link ListeningServer.close}. */
export interface CloseOptions {
  /**
   * Maximum time (ms) to wait for keep-alive sockets to drain naturally
   * before they are forcibly destroyed. When omitted (or undefined), no
   * force-close occurs and `close()` waits indefinitely for sockets to
   * finish — this matches the historical Node `server.close()` behavior.
   */
  gracefulTimeoutMs?: number
}

/** A transport-agnostic listening server handle. */
export interface ListeningServer {
  /** Bound port (resolved if `port: 0` was passed). */
  port: number
  /** The bound host. */
  host: string
  /**
   * Stop accepting new connections; resolves when in-flight requests
   * finish. If `gracefulTimeoutMs` is provided, idle keep-alive sockets
   * still open after that many milliseconds are forcibly destroyed.
   */
  close(opts?: CloseOptions): Promise<void>
}

/**
 * A transport binds the Ingenium dispatch loop to a concrete server
 * runtime (Node's `node:http`, Bun.serve, etc).
 */
export interface Transport {
  /** Wire up the transport with framework-side hooks. Called once by `app.listen()`. */
  attach(hooks: TransportHooks): void

  /** Bind to a port and start accepting requests. */
  listen(port: number, host?: string): Promise<ListeningServer>
}
