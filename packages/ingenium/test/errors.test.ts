import { describe, it, expect } from 'vitest'
import {
  IngeniumError,
  IngeniumNotFoundError,
  IngeniumUnauthorizedError,
  IngeniumMethodNotAllowedError,
  IngeniumPayloadTooLargeError,
  IngeniumValidationError,
  IngeniumBadRequestError,
} from '../src/errors.ts'

/**
 * Errors are serialized over the wire by the default boundary, so they need
 * stable `statusCode`, `code`, `message`, and (for some) extra fields like
 * `fields` / `allowed`. These tests pin those contracts.
 */
describe('IngeniumError hierarchy', () => {
  it('IngeniumError base class carries statusCode/code/message/cause', () => {
    const cause = new Error('underlying')
    const err = new IngeniumError(500, 'INTERNAL', 'boom', cause)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(IngeniumError)
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL')
    expect(err.message).toBe('boom')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('IngeniumError')
  })

  it('IngeniumNotFoundError defaults to 404 / NOT_FOUND', () => {
    const err = new IngeniumNotFoundError()
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Not Found')
    expect(err.name).toBe('IngeniumNotFoundError')
    const custom = new IngeniumNotFoundError('No such user')
    expect(custom.message).toBe('No such user')
  })

  it('IngeniumUnauthorizedError defaults to 401 / UNAUTHORIZED', () => {
    const err = new IngeniumUnauthorizedError()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.message).toBe('Unauthorized')
    expect(err.name).toBe('IngeniumUnauthorizedError')
  })

  it('IngeniumMethodNotAllowedError captures `allowed` list', () => {
    const err = new IngeniumMethodNotAllowedError(['GET', 'POST'])
    expect(err.statusCode).toBe(405)
    expect(err.code).toBe('METHOD_NOT_ALLOWED')
    expect(err.allowed).toEqual(['GET', 'POST'])
    expect(err.name).toBe('IngeniumMethodNotAllowedError')
  })

  it('IngeniumPayloadTooLargeError defaults to 413', () => {
    const err = new IngeniumPayloadTooLargeError()
    expect(err.statusCode).toBe(413)
    expect(err.code).toBe('PAYLOAD_TOO_LARGE')
    expect(err.message).toBe('Payload Too Large')
    expect(err.name).toBe('IngeniumPayloadTooLargeError')
  })

  it('IngeniumValidationError captures `fields`', () => {
    const fields = { email: 'must be email', age: 'must be int' }
    const err = new IngeniumValidationError(fields)
    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.fields).toEqual(fields)
    expect(err.name).toBe('IngeniumValidationError')
  })

  it('IngeniumBadRequestError defaults to 400 and forwards cause', () => {
    const cause = new SyntaxError('Unexpected token')
    const err = new IngeniumBadRequestError('Bad JSON', cause)
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.message).toBe('Bad JSON')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('IngeniumBadRequestError')
  })

  it('all subclasses survive a manual JSON serialization round-trip', () => {
    // Errors aren't JSON.stringify-friendly by default (no enumerable props),
    // so the framework's boundary builds the payload explicitly. Mirror that
    // here to confirm every relevant field is reachable as a plain prop.
    const cases: Array<[IngeniumError, Record<string, unknown>]> = [
      [new IngeniumNotFoundError(), { error: 'Not Found', code: 'NOT_FOUND' }],
      [new IngeniumUnauthorizedError(), { error: 'Unauthorized', code: 'UNAUTHORIZED' }],
      [
        new IngeniumMethodNotAllowedError(['GET']),
        { error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED', allowed: ['GET'] },
      ],
      [new IngeniumPayloadTooLargeError(), { error: 'Payload Too Large', code: 'PAYLOAD_TOO_LARGE' }],
      [
        new IngeniumValidationError({ name: 'required' }),
        { error: 'Validation Failed', code: 'VALIDATION_FAILED', fields: { name: 'required' } },
      ],
      [new IngeniumBadRequestError(), { error: 'Bad Request', code: 'BAD_REQUEST' }],
    ]
    for (const [err, expected] of cases) {
      const payload: Record<string, unknown> = { error: err.message, code: err.code }
      if (err instanceof IngeniumValidationError) payload.fields = err.fields
      if (err instanceof IngeniumMethodNotAllowedError) payload.allowed = err.allowed
      const serialized = JSON.parse(JSON.stringify(payload))
      expect(serialized).toEqual(expected)
    }
  })
})
