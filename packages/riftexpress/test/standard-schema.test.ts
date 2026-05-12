import { describe, it, expect } from 'vitest'
import { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { RexBody } from '../src/context/body.ts'
import { RexValidationError } from '../src/errors.ts'
import {
  isStandardSchema,
  type StandardResult,
  type StandardSchemaV1,
} from '../src/schema/standard.ts'

const attach = (body: RexBody, src: Readable | null) => body._attach(src, undefined, undefined)
const stream = (s: string) => Readable.from([Buffer.from(s)])

describe('Standard Schema support in RexBody.json()', () => {
  it('returns the validated value on a successful sync schema', async () => {
    const schema: StandardSchemaV1<unknown, { name: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(input): StandardResult<{ name: string }> {
          const obj = input as { name?: unknown }
          if (typeof obj.name !== 'string') {
            return { issues: [{ message: 'name must be string', path: ['name'] }] }
          }
          return { value: { name: obj.name } }
        },
      },
    }
    const body = new RexBody()
    attach(body, stream('{"name":"alice"}'))
    const out = await body.json(schema)
    expect(out).toEqual({ name: 'alice' })
  })

  it('throws RexValidationError with multi-path fields on multiple issues', async () => {
    const schema: StandardSchemaV1<unknown, { user: { email: string }; age: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(): StandardResult<{ user: { email: string }; age: number }> {
          return {
            issues: [
              // bare-key path → 'user.email'
              { message: 'invalid email', path: ['user', 'email'] },
              // segment-object path → 'age'
              { message: 'must be > 0', path: [{ key: 'age' }] },
            ],
          }
        },
      },
    }
    const body = new RexBody()
    attach(body, stream('{}'))
    try {
      await body.json(schema)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RexValidationError)
      const fields = (err as RexValidationError).fields
      expect(fields).toEqual({
        'user.email': 'invalid email',
        age: 'must be > 0',
      })
    }
  })

  it('maps an empty path to "_"', async () => {
    const schema: StandardSchemaV1<unknown, unknown> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (): StandardResult<unknown> => ({
          issues: [{ message: 'root failure' }],
        }),
      },
    }
    const body = new RexBody()
    attach(body, stream('{}'))
    await expect(body.json(schema)).rejects.toMatchObject({
      fields: { _: 'root failure' },
    })
  })

  it('awaits async validate()', async () => {
    const schema: StandardSchemaV1<unknown, { ok: true }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        async validate(input): Promise<StandardResult<{ ok: true }>> {
          await new Promise((r) => setTimeout(r, 5))
          const obj = input as { ok?: unknown }
          if (obj.ok !== true) return { issues: [{ message: 'not ok', path: ['ok'] }] }
          return { value: { ok: true } }
        },
      },
    }
    const ok = new RexBody()
    attach(ok, stream('{"ok":true}'))
    expect(await ok.json(schema)).toEqual({ ok: true })

    const bad = new RexBody()
    attach(bad, stream('{"ok":false}'))
    await expect(bad.json(schema)).rejects.toMatchObject({
      fields: { ok: 'not ok' },
    })
  })

  it('Standard Schema path takes precedence over safeParse on the same schema', async () => {
    let safeParseCalled = false
    let standardCalled = false
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate(input: unknown): StandardResult<{ via: 'standard' }> {
          standardCalled = true
          void input
          return { value: { via: 'standard' } }
        },
      },
      safeParse(_input: unknown) {
        safeParseCalled = true
        return { success: true as const, data: { via: 'safeParse' as const } }
      },
    }
    const body = new RexBody()
    attach(body, stream('{}'))
    const out = await body.json(schema as unknown as StandardSchemaV1<unknown, { via: 'standard' }>)
    expect(out).toEqual({ via: 'standard' })
    expect(standardCalled).toBe(true)
    expect(safeParseCalled).toBe(false)
  })
})

describe('isStandardSchema()', () => {
  it('returns true for a hand-rolled Standard Schema', () => {
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (input) => ({ value: input }),
      },
    }
    expect(isStandardSchema(schema)).toBe(true)
  })

  it('returns false for a Zod-style schema without ~standard', () => {
    const zodish = {
      safeParse: (_input: unknown) => ({ success: true as const, data: {} }),
      parse: (input: unknown) => input,
    }
    expect(isStandardSchema(zodish)).toBe(false)
  })

  it('returns false for plain objects, null, undefined, and primitives', () => {
    expect(isStandardSchema({})).toBe(false)
    expect(isStandardSchema({ '~standard': {} })).toBe(false)
    expect(isStandardSchema({ '~standard': { version: 2, validate: () => ({ value: 1 }) } })).toBe(false)
    expect(isStandardSchema({ '~standard': { version: 1, validate: 'nope' } })).toBe(false)
    expect(isStandardSchema(null)).toBe(false)
    expect(isStandardSchema(undefined)).toBe(false)
    expect(isStandardSchema(42)).toBe(false)
    expect(isStandardSchema('string')).toBe(false)
  })
})
