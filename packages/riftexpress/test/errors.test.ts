import { describe, it, expect } from 'vitest'
import {
  RiftexError,
  RiftexNotFoundError,
  RiftexUnauthorizedError,
  RiftexMethodNotAllowedError,
  RiftexPayloadTooLargeError,
  RiftexValidationError,
  RiftexBadRequestError,
} from '../src/errors.ts'

/**
 * Errors are serialized over the wire by the default boundary, so they need
 * stable `statusCode`, `code`, `message`, and (for some) extra fields like
 * `fields` / `allowed`. These tests pin those contracts.
 */
describe('RiftexError hierarchy', () => {
  it('RiftexError base class carries statusCode/code/message/cause', () => {
    const cause = new Error('underlying')
    const err = new RiftexError(500, 'INTERNAL', 'boom', cause)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RiftexError)
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL')
    expect(err.message).toBe('boom')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('RiftexError')
  })

  it('RiftexNotFoundError defaults to 404 / NOT_FOUND', () => {
    const err = new RiftexNotFoundError()
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Not Found')
    expect(err.name).toBe('RiftexNotFoundError')
    const custom = new RiftexNotFoundError('No such user')
    expect(custom.message).toBe('No such user')
  })

  it('RiftexUnauthorizedError defaults to 401 / UNAUTHORIZED', () => {
    const err = new RiftexUnauthorizedError()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.message).toBe('Unauthorized')
    expect(err.name).toBe('RiftexUnauthorizedError')
  })

  it('RiftexMethodNotAllowedError captures `allowed` list', () => {
    const err = new RiftexMethodNotAllowedError(['GET', 'POST'])
    expect(err.statusCode).toBe(405)
    expect(err.code).toBe('METHOD_NOT_ALLOWED')
    expect(err.allowed).toEqual(['GET', 'POST'])
    expect(err.name).toBe('RiftexMethodNotAllowedError')
  })

  it('RiftexPayloadTooLargeError defaults to 413', () => {
    const err = new RiftexPayloadTooLargeError()
    expect(err.statusCode).toBe(413)
    expect(err.code).toBe('PAYLOAD_TOO_LARGE')
    expect(err.message).toBe('Payload Too Large')
    expect(err.name).toBe('RiftexPayloadTooLargeError')
  })

  it('RiftexValidationError captures `fields`', () => {
    const fields = { email: 'must be email', age: 'must be int' }
    const err = new RiftexValidationError(fields)
    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.fields).toEqual(fields)
    expect(err.name).toBe('RiftexValidationError')
  })

  it('RiftexBadRequestError defaults to 400 and forwards cause', () => {
    const cause = new SyntaxError('Unexpected token')
    const err = new RiftexBadRequestError('Bad JSON', cause)
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.message).toBe('Bad JSON')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('RiftexBadRequestError')
  })

  it('all subclasses survive a manual JSON serialization round-trip', () => {
    // Errors aren't JSON.stringify-friendly by default (no enumerable props),
    // so the framework's boundary builds the payload explicitly. Mirror that
    // here to confirm every relevant field is reachable as a plain prop.
    const cases: Array<[RiftexError, Record<string, unknown>]> = [
      [new RiftexNotFoundError(), { error: 'Not Found', code: 'NOT_FOUND' }],
      [new RiftexUnauthorizedError(), { error: 'Unauthorized', code: 'UNAUTHORIZED' }],
      [
        new RiftexMethodNotAllowedError(['GET']),
        { error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED', allowed: ['GET'] },
      ],
      [new RiftexPayloadTooLargeError(), { error: 'Payload Too Large', code: 'PAYLOAD_TOO_LARGE' }],
      [
        new RiftexValidationError({ name: 'required' }),
        { error: 'Validation Failed', code: 'VALIDATION_FAILED', fields: { name: 'required' } },
      ],
      [new RiftexBadRequestError(), { error: 'Bad Request', code: 'BAD_REQUEST' }],
    ]
    for (const [err, expected] of cases) {
      const payload: Record<string, unknown> = { error: err.message, code: err.code }
      if (err instanceof RiftexValidationError) payload.fields = err.fields
      if (err instanceof RiftexMethodNotAllowedError) payload.allowed = err.allowed
      const serialized = JSON.parse(JSON.stringify(payload))
      expect(serialized).toEqual(expected)
    }
  })
})
