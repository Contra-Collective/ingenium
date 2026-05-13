/**
 * Base error class for all framework-emitted errors. Errors that extend
 * `RiftexError` are caught by the global error boundary and serialized to the
 * client according to their `statusCode` and `code`.
 */
export class RiftexError extends Error {
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
export class RiftexNotFoundError extends RiftexError {
  constructor(message = 'Not Found') {
    super(404, 'NOT_FOUND', message)
  }
}

/** 401 — authentication required or invalid. */
export class RiftexUnauthorizedError extends RiftexError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
  }
}

/**
 * 405 — path matched but method did not. Includes the list of allowed methods,
 * which the framework writes into the `Allow` response header automatically.
 */
export class RiftexMethodNotAllowedError extends RiftexError {
  constructor(public readonly allowed: readonly string[], message = 'Method Not Allowed') {
    super(405, 'METHOD_NOT_ALLOWED', message)
  }
}

/** 413 — request body exceeded the configured `maxBytes` limit. */
export class RiftexPayloadTooLargeError extends RiftexError {
  constructor(message = 'Payload Too Large') {
    super(413, 'PAYLOAD_TOO_LARGE', message)
  }
}

/**
 * 422 — request body parsed successfully but failed validation. The `fields`
 * map is serialized into the response body so clients can render field-level
 * error messages.
 */
export class RiftexValidationError extends RiftexError {
  constructor(public readonly fields: Record<string, string>, message = 'Validation Failed') {
    super(422, 'VALIDATION_FAILED', message)
  }
}

/** 400 — request was malformed (bad JSON, invalid content-type, etc). */
export class RiftexBadRequestError extends RiftexError {
  constructor(message = 'Bad Request', cause?: unknown) {
    super(400, 'BAD_REQUEST', message, cause)
  }
}
