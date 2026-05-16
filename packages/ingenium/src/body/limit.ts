import { Transform, type TransformCallback } from 'node:stream'
import { IngeniumPayloadTooLargeError } from '../errors.ts'

/**
 * A `Transform` stream that aborts with `IngeniumPayloadTooLargeError` as soon as
 * cumulative throughput exceeds `maxBytes`. The check happens before the
 * chunk is emitted downstream, so consumers never see bytes past the limit.
 */
export function createByteLimit(maxBytes: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      total += chunk.length
      if (total > maxBytes) {
        callback(new IngeniumPayloadTooLargeError(`Request body exceeded ${maxBytes} bytes`))
        return
      }
      callback(null, chunk)
    },
  })
}
