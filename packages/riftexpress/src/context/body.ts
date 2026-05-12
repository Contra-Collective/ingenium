import type { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { RexBadRequestError, RexPayloadTooLargeError, RexValidationError } from '../errors.ts'
import { createByteLimit } from '../body/limit.ts'
import { parseMultipart } from '../body/multipart.ts'
import type { MultipartOptions, MultipartResult } from '../body/multipart-types.ts'
import {
  isStandardSchema,
  type StandardIssue,
  type StandardSchemaV1,
} from '../schema/standard.ts'

/** Minimal duck-type for any validation library that accepts unknown and returns a typed value. */
export interface ParseSchema<T> {
  parse(input: unknown): T
}

/** Optional Zod-like schema: success/failure object output (used internally for friendlier errors). */
export interface SafeParseSchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: ZodLikeIssue[] } }
}

interface ZodLikeIssue {
  path: ReadonlyArray<string | number>
  message: string
}

/** Normalize a Standard Schema issue path into a dot-joined field key. */
function standardPathToField(path: StandardIssue['path']): string {
  if (!path || path.length === 0) return '_'
  const parts: string[] = []
  for (const seg of path) {
    if (seg !== null && typeof seg === 'object' && 'key' in seg) {
      parts.push(String(seg.key))
    } else {
      parts.push(String(seg))
    }
  }
  return parts.join('.') || '_'
}

/**
 * Default body size limit for `RexBody.json/text/urlencoded/buffer`.
 * 100,000 bytes matches Express's `body-parser` default (`'100kb'`),
 * which is the convention every Express app implicitly relies on. Override
 * per-call (`ctx.body.json(undefined, 5_000_000)`) or set a different
 * default by configuring your `rex.json({ limit })` middleware (the
 * middleware is currently a stub — see `body/middleware.ts`).
 */
const DEFAULT_MAX_BYTES = 100_000

/**
 * Lazy body accessor. Bytes are not read until one of the consume methods
 * (`json`, `text`, `urlencoded`, `buffer`, `stream`) is called.
 *
 * One instance is allocated per `RexContext` (pool-bound), so per-request
 * cost is just a `reset()`.
 */
export class RexBody {
  /** @internal */ _source: Readable | null = null
  /** @internal */ _consumed = false
  /** @internal */ _contentType: string | undefined = undefined
  /** @internal */ _contentLength: number | undefined = undefined

  /** @internal Adapter calls this on each request before dispatch. */
  _attach(source: Readable | null, contentType: string | undefined, contentLength: number | undefined): void {
    this._source = source
    this._consumed = false
    this._contentType = contentType
    this._contentLength = contentLength
  }

  /** @internal Pool reset. */
  _reset(): void {
    this._source = null
    this._consumed = false
    this._contentType = undefined
    this._contentLength = undefined
  }

  /** Returns the raw request body stream. Throws if already consumed. */
  stream(): Readable {
    if (this._consumed) throw new RexBadRequestError('Request body already consumed')
    if (!this._source) throw new RexBadRequestError('Request has no body')
    this._consumed = true
    return this._source
  }

  /** Buffers the entire body into a `Buffer`. Honors `maxBytes` (default 1 MiB). */
  async buffer(maxBytes: number = DEFAULT_MAX_BYTES): Promise<Buffer> {
    if (this._consumed) throw new RexBadRequestError('Request body already consumed')
    if (!this._source) return Buffer.alloc(0)
    this._consumed = true

    if (this._contentLength !== undefined && this._contentLength > maxBytes) {
      // Drain source so the connection can be reused.
      this._source.resume()
      throw new (await import('../errors.ts')).RexPayloadTooLargeError(
        `Request body exceeded ${maxBytes} bytes`,
      )
    }

    const limited = this._source.pipe(createByteLimit(maxBytes))
    const chunks: Buffer[] = []
    return new Promise<Buffer>((resolve, reject) => {
      limited.on('data', (chunk: Buffer) => chunks.push(chunk))
      limited.on('end', () => resolve(Buffer.concat(chunks)))
      limited.on('error', reject)
    })
  }

  /** Buffers the body and decodes as UTF-8 text. */
  async text(maxBytes?: number): Promise<string> {
    const buf = await this.buffer(maxBytes)
    return buf.toString('utf8')
  }

  /**
   * Parses the body as JSON. If a schema is provided, the parsed value is
   * validated. Detection order:
   *
   *   1. Standard Schema v1 (`["~standard"]`) — async-aware, multi-issue
   *   2. Zod-like `safeParse(input)` — multi-issue
   *   3. Plain `parse(input): T` — throws on failure
   *
   * Validation failures are normalized into `RexValidationError` with a
   * field-level `fields` map (dot-joined paths; empty path → `_`).
   */
  async json<T = unknown>(
    schema?: StandardSchemaV1<unknown, T> | SafeParseSchema<T> | ParseSchema<T>,
    maxBytes?: number,
  ): Promise<T> {
    const text = await this.text(maxBytes)
    let parsed: unknown
    try {
      parsed = text.length === 0 ? null : JSON.parse(text)
    } catch (err) {
      throw new RexBadRequestError('Invalid JSON', err)
    }
    if (schema) {
      // 1. Standard Schema v1 — most modern, takes precedence.
      if (isStandardSchema(schema)) {
        const maybe = schema['~standard'].validate(parsed)
        const result = maybe instanceof Promise ? await maybe : maybe
        if (result.issues) {
          const fields: Record<string, string> = {}
          for (const issue of result.issues) {
            fields[standardPathToField(issue.path)] = issue.message
          }
          throw new RexValidationError(fields)
        }
        return result.value as T
      }
      // 2. Zod-like safeParse.
      if ('safeParse' in schema && typeof (schema as SafeParseSchema<T>).safeParse === 'function') {
        const result = (schema as SafeParseSchema<T>).safeParse(parsed)
        if (!result.success) {
          const fields: Record<string, string> = {}
          for (const issue of result.error.issues) {
            fields[issue.path.join('.') || '_'] = issue.message
          }
          throw new RexValidationError(fields)
        }
        return result.data
      }
      // 3. Plain parse.
      try {
        return (schema as ParseSchema<T>).parse(parsed)
      } catch (err) {
        throw new RexValidationError({ _: (err as Error).message ?? 'validation failed' })
      }
    }
    return parsed as T
  }

  /** Parses the body as `application/x-www-form-urlencoded`. */
  async urlencoded(maxBytes?: number): Promise<Record<string, string>> {
    const text = await this.text(maxBytes)
    const params = new URLSearchParams(text)
    const out: Record<string, string> = {}
    for (const [k, v] of params) out[k] = v
    return out
  }

  /**
   * Parses the body as `multipart/form-data` (RFC 7578).
   *
   * Returns plain-text fields and fully buffered file parts. For very large
   * uploads prefer `stream()` and parse manually — this method holds every
   * file in memory.
   *
   * Failure modes:
   * - Body exceeds `maxBytes` → `RexPayloadTooLargeError`
   * - Single file exceeds `maxFileSize` → `RexPayloadTooLargeError`
   * - Too many files / fields → `RexBadRequestError`
   * - Disallowed mime type → `RexBadRequestError`
   * - Content-Type isn't `multipart/form-data` or boundary missing → `RexBadRequestError`
   * - Malformed body → `RexBadRequestError`
   */
  async multipart(opts: MultipartOptions = {}): Promise<MultipartResult> {
    const contentType = this._contentType
    const buf = await this.buffer(opts.maxBytes ?? DEFAULT_MAX_BYTES)
    try {
      return parseMultipart(buf, contentType, opts)
    } catch (err) {
      // Preserve framework errors (415/413/400) as-is.
      if (err instanceof RexPayloadTooLargeError || err instanceof RexBadRequestError) {
        throw err
      }
      throw new RexBadRequestError('Malformed multipart body', err)
    }
  }
}
