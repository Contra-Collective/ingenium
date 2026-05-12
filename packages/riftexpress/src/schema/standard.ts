/**
 * Local, zero-dependency type definitions for the
 * [Standard Schema](https://standardschema.dev) v1 spec.
 *
 * RiftExpress detects schemas implementing this contract on
 * `RexBody.json(schema)` and runs their `validate` function, mapping
 * `issues` into a `RexValidationError` with field-level messages.
 *
 * We intentionally do NOT import `@standard-schema/spec` to keep the
 * core dependency-free. These types mirror the spec exactly.
 */

/** A successful validation result: parsed/transformed value. */
export interface StandardSuccessResult<TOut> {
  readonly value: TOut
  readonly issues?: undefined
}

/** A single issue describing why validation failed at a particular path. */
export interface StandardIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined
}

/** A path segment may be a bare key OR an object with a `key` property. */
export interface StandardPathSegment {
  readonly key: PropertyKey
}

/** A failed validation result: one or more issues. */
export interface StandardFailureResult {
  readonly issues: ReadonlyArray<StandardIssue>
  readonly value?: undefined
}

/** Standard Schema validation result: success XOR failure. */
export type StandardResult<TOut> = StandardSuccessResult<TOut> | StandardFailureResult

/** The properties living under the `~standard` key. */
export interface StandardSchemaV1Props<TIn = unknown, TOut = TIn> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (input: unknown) => StandardResult<TOut> | Promise<StandardResult<TOut>>
  readonly types?: {
    readonly input: TIn
    readonly output: TOut
  } | undefined
}

/** The Standard Schema v1 interface — anything with a `~standard` property. */
export interface StandardSchemaV1<TIn = unknown, TOut = TIn> {
  readonly '~standard': StandardSchemaV1Props<TIn, TOut>
}

/**
 * Type guard: is `x` a Standard Schema v1?
 *
 * Checks for the `~standard` property and that its `version` is `1` and
 * `validate` is a function. Cheap enough to call on every body.json() call.
 */
export function isStandardSchema(x: unknown): x is StandardSchemaV1 {
  if (x === null || (typeof x !== 'object' && typeof x !== 'function')) return false
  const std = (x as { '~standard'?: unknown })['~standard']
  if (std === null || typeof std !== 'object') return false
  const props = std as { version?: unknown; validate?: unknown }
  return props.version === 1 && typeof props.validate === 'function'
}
