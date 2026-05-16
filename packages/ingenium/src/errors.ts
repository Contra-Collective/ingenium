/**
 * Base error class for all framework-emitted errors. Errors that extend
 * `IngeniumError` are caught by the global error boundary and serialized to the
 * client according to their `statusCode` and `code`.
 */
export class IngeniumError extends Error {
  /**
   * @param statusCode HTTP status code to send to the client.
   * @param code Machine-readable error code (UPPER_SNAKE_CASE convention).
   * @param message Human-readable error message.
   * @param cause Optional underlying error.
   */
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
    this.name = new.target.name
  }
}

/** 404 — no route matched. */
export class IngeniumNotFoundError extends IngeniumError {
  constructor(message = 'Not Found') {
    super(404, 'NOT_FOUND', message)
  }
}

/** 401 — authentication required or invalid. */
export class IngeniumUnauthorizedError extends IngeniumError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
  }
}

/**
 * 405 — path matched but method did not. Includes the list of allowed methods,
 * which the framework writes into the `Allow` response header automatically.
 */
export class IngeniumMethodNotAllowedError extends IngeniumError {
  constructor(public readonly allowed: readonly string[], message = 'Method Not Allowed') {
    super(405, 'METHOD_NOT_ALLOWED', message)
  }
}

/** 413 — request body exceeded the configured `maxBytes` limit. */
export class IngeniumPayloadTooLargeError extends IngeniumError {
  constructor(message = 'Payload Too Large') {
    super(413, 'PAYLOAD_TOO_LARGE', message)
  }
}

/**
 * 422 — request body parsed successfully but failed validation. The `fields`
 * map is serialized into the response body so clients can render field-level
 * error messages.
 */
export class IngeniumValidationError extends IngeniumError {
  constructor(public readonly fields: Record<string, string>, message = 'Validation Failed') {
    super(422, 'VALIDATION_FAILED', message)
  }
}

/** 400 — request was malformed (bad JSON, invalid content-type, etc). */
export class IngeniumBadRequestError extends IngeniumError {
  constructor(message = 'Bad Request', cause?: unknown) {
    super(400, 'BAD_REQUEST', message, cause)
  }
}

/**
 * 500 — caller attempted to write a header name or value containing CR or
 * LF. Node would eventually reject these at the wire level, but the late
 * throw produces a useless stack — we fail fast at the call site so the
 * offending header (and the route that set it) shows up in the trace.
 */
export class IngeniumHeaderInjectionError extends IngeniumError {
  constructor(message = 'Header value contains CR/LF (possible header injection)') {
    super(500, 'HEADER_INJECTION', message)
  }
}

/**
 * 500 — `ctx.json` (or `respondJsonWithEtag`) was handed a value that
 * `JSON.stringify` cannot serialize: a circular structure, a `BigInt`, or
 * any other unsupported shape. The original `TypeError` is attached as
 * `cause` and emitted via `process.emitWarning` for diagnostics.
 */
export class IngeniumUnserializableError extends IngeniumError {
  constructor(message: string, cause?: unknown) {
    super(500, 'UNSERIALIZABLE_RESPONSE', message, cause)
  }
}

/**
 * Sinatra-style `halt` short-circuit. Thrown by `ctx.halt(status, body?)`;
 * caught by the default error boundary and serialized according to `bodyShape`:
 *
 * - `'none'`  → boundary uses default `{ error, code: 'HALT' }` JSON shape.
 * - `'text'`  → boundary writes `body` as `text/plain` verbatim.
 * - `'json'`  → boundary writes `body` as `application/json`.
 *
 * The body shape is decided at the call site (string ⇒ text, object ⇒ json,
 * undefined ⇒ none) so the boundary can branch without re-inspecting types.
 * Custom `app.onError` handlers still receive the error and can override it
 * (e.g. add a header, reshape the body) by writing the response themselves.
 */
export class IngeniumHaltError extends IngeniumError {
  /** What the default error boundary should do with `body`. */
  readonly bodyShape: 'none' | 'text' | 'json'
  /** The body argument from `ctx.halt(status, body?)`. */
  readonly body: string | Record<string, unknown> | undefined

  constructor(statusCode: number, body?: string | Record<string, unknown>) {
    let shape: 'none' | 'text' | 'json'
    let message: string
    if (body === undefined) {
      shape = 'none'
      message = `Halted with status ${statusCode}`
    } else if (typeof body === 'string') {
      shape = 'text'
      message = body
    } else {
      shape = 'json'
      // Best-effort message for ctx.error / logging; the JSON body is the
      // wire-level payload regardless.
      message = typeof body['error'] === 'string' ? (body['error'] as string) : 'HALT'
    }
    super(statusCode, 'HALT', message)
    this.bodyShape = shape
    this.body = body
  }
}

/**
 * 503 — handler exceeded the configured `requestTimeoutMs` ceiling. The
 * orphaned handler is NOT cancelled (JavaScript can't safely cancel a
 * Promise); the framework just stops waiting for it. Late writes from the
 * orphaned handler are guarded by the per-request epoch counter on the
 * context and discarded with a `process.emitWarning`.
 */
export class IngeniumTimeoutError extends IngeniumError {
  constructor(timeoutMs: number, message?: string) {
    super(503, 'REQUEST_TIMEOUT', message ?? `Request exceeded ${timeoutMs}ms`)
  }
}
