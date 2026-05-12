import { describe, it, expect } from 'vitest'
import {
  RexError,
  RexNotFoundError,
  RexUnauthorizedError,
  RexMethodNotAllowedError,
  RexPayloadTooLargeError,
  RexValidationError,
  RexBadRequestError,
} from '../src/errors.ts'

/**
 * Errors are serialized over the wire by the default boundary, so they need
 * stable `statusCode`, `code`, `message`, and (for some) extra fields like
 * `fields` / `allowed`. These tests pin those contracts.
 */
describe('RexError hierarchy', () => {
  it('RexError base class carries statusCode/code/message/cause', () => {
    const cause = new Error('underlying')
    const err = new RexError(500, 'INTERNAL', 'boom', cause)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RexError)
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL')
    expect(err.message).toBe('boom')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('RexError')
  })

  it('RexNotFoundError defaults to 404 / NOT_FOUND', () => {
    const err = new RexNotFoundError()
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Not Found')
    expect(err.name).toBe('RexNotFoundError')
    const custom = new RexNotFoundError('No such user')
    expect(custom.message).toBe('No such user')
  })

  it('RexUnauthorizedError defaults to 401 / UNAUTHORIZED', () => {
    const err = new RexUnauthorizedError()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.message).toBe('Unauthorized')
    expect(err.name).toBe('RexUnauthorizedError')
  })

  it('RexMethodNotAllowedError captures `allowed` list', () => {
    const err = new RexMethodNotAllowedError(['GET', 'POST'])
    expect(err.statusCode).toBe(405)
    expect(err.code).toBe('METHOD_NOT_ALLOWED')
    expect(err.allowed).toEqual(['GET', 'POST'])
    expect(err.name).toBe('RexMethodNotAllowedError')
  })

  it('RexPayloadTooLargeError defaults to 413', () => {
    const err = new RexPayloadTooLargeError()
    expect(err.statusCode).toBe(413)
    expect(err.code).toBe('PAYLOAD_TOO_LARGE')
    expect(err.message).toBe('Payload Too Large')
    expect(err.name).toBe('RexPayloadTooLargeError')
  })

  it('RexValidationError captures `fields`', () => {
    const fields = { email: 'must be email', age: 'must be int' }
    const err = new RexValidationError(fields)
    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.fields).toEqual(fields)
    expect(err.name).toBe('RexValidationError')
  })

  it('RexBadRequestError defaults to 400 and forwards cause', () => {
    const cause = new SyntaxError('Unexpected token')
    const err = new RexBadRequestError('Bad JSON', cause)
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.message).toBe('Bad JSON')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('RexBadRequestError')
  })

  it('all subclasses survive a manual JSON serialization round-trip', () => {
    // Errors aren't JSON.stringify-friendly by default (no enumerable props),
    // so the framework's boundary builds the payload explicitly. Mirror that
    // here to confirm every relevant field is reachable as a plain prop.
    const cases: Array<[RexError, Record<string, unknown>]> = [
      [new RexNotFoundError(), { error: 'Not Found', code: 'NOT_FOUND' }],
      [new RexUnauthorizedError(), { error: 'Unauthorized', code: 'UNAUTHORIZED' }],
      [
        new RexMethodNotAllowedError(['GET']),
        { error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED', allowed: ['GET'] },
      ],
      [new RexPayloadTooLargeError(), { error: 'Payload Too Large', code: 'PAYLOAD_TOO_LARGE' }],
      [
        new RexValidationError({ name: 'required' }),
        { error: 'Validation Failed', code: 'VALIDATION_FAILED', fields: { name: 'required' } },
      ],
      [new RexBadRequestError(), { error: 'Bad Request', code: 'BAD_REQUEST' }],
    ]
    for (const [err, expected] of cases) {
      const payload: Record<string, unknown> = { error: err.message, code: err.code }
      if (err instanceof RexValidationError) payload.fields = err.fields
      if (err instanceof RexMethodNotAllowedError) payload.allowed = err.allowed
      const serialized = JSON.parse(JSON.stringify(payload))
      expect(serialized).toEqual(expected)
    }
  })
})
