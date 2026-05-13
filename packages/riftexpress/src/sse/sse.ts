import { PassThrough } from 'node:stream'
import type { RiftexContext } from '../context/context.ts'

/**
 * A single Server-Sent Event. The `data` field is required; if you pass an
 * object, it's `JSON.stringify`'d before being written. All other fields are
 * optional and serialized per the EventSource specification.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
export interface SseEvent {
  /** Payload. Strings are written verbatim; objects are JSON-encoded. */
  data: string | object
  /** Optional event name — populates `event:` field. */
  event?: string
  /** Optional event id — populates `id:` field. */
  id?: string
  /** Optional retry hint in milliseconds — populates `retry:` field. */
  retry?: number
}

/**
 * Handle for an open SSE connection. Returned by {@link sse}. Use `send()`
 * to push events, `comment()` for keep-alive frames, and `close()` to end
 * the response stream cleanly.
 */
export interface SseStream {
  /**
   * Send a single event. A bare string is treated as `{ data: <string> }`.
   */
  send(event: SseEvent | string): void
  /** Write a comment line (`: <text>`). Useful for heartbeats / keep-alive. */
  comment(text: string): void
  /** End the response stream. Subsequent calls are no-ops. */
  close(): void
  /** Whether the underlying stream has been closed (locally or by the client). */
  readonly closed: boolean
}

/**
 * Open a Server-Sent Events response on the given context. Sets the
 * appropriate headers (`Content-Type: text/event-stream`, no caching, no
 * proxy buffering) and wires a `PassThrough` into `ctx.stream()`.
 *
 * @example
 *   app.get('/events', (ctx) => {
 *     const stream = sse(ctx)
 *     stream.send({ event: 'hello', data: { msg: 'world' } })
 *     setTimeout(() => stream.close(), 1000)
 *   })
 */
export function sse(ctx: RiftexContext): SseStream {
  const passthrough = new PassThrough()

  // SSE headers — set BEFORE ctx.stream() so the adapter can flush them.
  ctx.set('cache-control', 'no-cache')
  ctx.set('connection', 'keep-alive')
  // Disable proxy buffering (nginx-specific but harmless elsewhere).
  ctx.set('x-accel-buffering', 'no')

  ctx.stream(passthrough, 'text/event-stream; charset=utf-8')

  let closed = false
  passthrough.on('close', () => {
    closed = true
  })

  function write(chunk: string): void {
    if (closed) return
    if (!passthrough.writable) {
      closed = true
      return
    }
    passthrough.write(chunk)
  }

  return {
    get closed(): boolean {
      return closed
    },

    send(eventOrString: SseEvent | string): void {
      if (closed) return
      const evt: SseEvent =
        typeof eventOrString === 'string' ? { data: eventOrString } : eventOrString

      let frame = ''
      if (evt.event !== undefined) frame += `event: ${evt.event}\n`
      if (evt.id !== undefined) frame += `id: ${evt.id}\n`
      if (evt.retry !== undefined) frame += `retry: ${evt.retry}\n`

      const dataStr =
        typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data)
      // Spec: split on newlines, emit one `data:` line per chunk.
      const lines = dataStr.split('\n')
      for (const line of lines) {
        frame += `data: ${line}\n`
      }
      frame += '\n'
      write(frame)
    },

    comment(text: string): void {
      if (closed) return
      // Comment lines start with ':'. Use \n\n terminator to flush.
      write(`: ${text}\n\n`)
    },

    close(): void {
      if (closed) return
      closed = true
      passthrough.end()
    },
  }
}
