import { Readable } from 'node:stream'

/**
 * Convert a WinterCG `ReadableStream<Uint8Array>` (e.g. `Request.body` in
 * Bun) into a Node `Readable`. Uses the built-in `Readable.fromWeb` bridge.
 *
 * The returned stream is lazy: the WinterCG source is only pulled when the
 * Node consumer actually reads. This is critical so handlers that never
 * touch `ctx.body.*` pay nothing for the body bridge.
 */
export function webStreamToNodeReadable(rs: ReadableStream<Uint8Array>): Readable {
  // `Readable.fromWeb` is available in Node >= 17 and in Bun. The cast covers
  // a slight type mismatch between Node's `ReadableStream` and the lib-dom one.
  return Readable.fromWeb(rs as Parameters<typeof Readable.fromWeb>[0])
}

/**
 * Convert a Node `Readable` back into a WinterCG `ReadableStream<Uint8Array>`
 * suitable for passing as the body of a `new Response()`.
 */
export function nodeReadableToWebStream(r: Readable): ReadableStream<Uint8Array> {
  // `Readable.toWeb` returns Node's flavor of `ReadableStream`; the runtime
  // object is interchangeable with the global one expected by `Response`.
  return Readable.toWeb(r) as unknown as ReadableStream<Uint8Array>
}
