import type { SseStream } from './sse.ts'

/**
 * Send a `:keepalive` comment to the given SSE stream every `intervalMs`
 * milliseconds. Returns a cancellation function.
 *
 * The interval is automatically cancelled when the stream closes — but
 * callers should still hold onto the cancel function for explicit cleanup
 * (e.g. on a separate teardown signal).
 *
 * The internal timer is `unref()`'d so it won't keep the Node event loop
 * alive on its own.
 *
 * @example
 *   const stream = sse(ctx)
 *   const cancel = startKeepAlive(stream, 15_000)
 *   ctx.req.on('close', cancel) // optional
 */
export function startKeepAlive(
  stream: SseStream,
  intervalMs = 15_000,
): () => void {
  let cancelled = false

  const timer = setInterval(() => {
    if (cancelled || stream.closed) {
      clearInterval(timer)
      return
    }
    stream.comment('keepalive')
  }, intervalMs)

  if (typeof timer.unref === 'function') timer.unref()

  // Best-effort: clear the interval as soon as we observe the stream closing.
  // The interval also self-clears via the closed-check above, but this
  // shortens the window before the next tick fires.
  const watcher = setInterval(() => {
    if (stream.closed) {
      clearInterval(timer)
      clearInterval(watcher)
    }
  }, Math.max(50, Math.min(intervalMs, 1000)))
  if (typeof watcher.unref === 'function') watcher.unref()

  return () => {
    if (cancelled) return
    cancelled = true
    clearInterval(timer)
    clearInterval(watcher)
  }
}
