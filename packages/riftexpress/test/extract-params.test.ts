import { describe, it, expectTypeOf } from 'vitest'
import type { ExtractParams } from '../src/router/types.ts'

/**
 * Type-level tests for ExtractParams<Path>. These don't have runtime behavior
 * to assert; `expectTypeOf` raises a compile error if the inferred type
 * doesn't match. Vitest only collects `.test.ts` files, so we use that
 * extension and a body of `expectTypeOf` checks.
 */
describe('ExtractParams<Path>', () => {
  it('extracts a single required param', () => {
    type P = ExtractParams<'/users/:id'>
    expectTypeOf<P>().toEqualTypeOf<{ id: string }>()
  })

  it('marks `?`-suffixed params as optional', () => {
    type P = ExtractParams<'/users/:id?'>
    expectTypeOf<P>().toEqualTypeOf<{ id?: string }>()
  })

  it('extracts multiple required params', () => {
    type P = ExtractParams<'/users/:userId/posts/:postId'>
    expectTypeOf<P>().toMatchTypeOf<{ userId: string; postId: string }>()
    // Drilled-down per-key checks (more robust against record-merge shape).
    expectTypeOf<P['userId']>().toEqualTypeOf<string>()
    expectTypeOf<P['postId']>().toEqualTypeOf<string>()
  })

  it('extracts wildcard tail under its given name', () => {
    type P = ExtractParams<'/files/*path'>
    expectTypeOf<P>().toEqualTypeOf<{ path: string }>()
  })

  it('returns the empty record when there are no params', () => {
    type P = ExtractParams<'/health'>
    expectTypeOf<P>().toEqualTypeOf<Record<string, never>>()
  })

  it('handles a mix of required and optional params', () => {
    type P = ExtractParams<'/users/:id/posts/:slug?'>
    expectTypeOf<P['id']>().toEqualTypeOf<string>()
    expectTypeOf<P>().toMatchTypeOf<{ id: string; slug?: string }>()
  })
})
