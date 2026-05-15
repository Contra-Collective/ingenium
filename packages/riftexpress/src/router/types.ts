/** HTTP methods supported by the router. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export const HTTP_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const

/**
 * Recursively extracts named params from a path string at the type level.
 *
 * - `:name`           → required string
 * - `:name?`          → optional string (becomes `string | undefined`)
 * - `:name(regex)`    → required string (regex is type-stripped; runtime
 *                       does not yet enforce the constraint)
 * - `*name`           → required string (greedy wildcard tail)
 *
 * @example
 * type P = ExtractParams<'/users/:id(\\d+)/posts/:slug?'>
 * // { id: string; slug?: string | undefined }
 */
export type ExtractParams<Path extends string> = Path extends `${string}:${infer Param}/${infer Rest}`
  ? ParamRecord<Param> & ExtractParams<`/${Rest}`>
  : Path extends `${string}:${infer Param}`
    ? ParamRecord<Param>
    : Path extends `${string}*${infer Wild}`
      ? { [K in Wild]: string }
      : EmptyParams

type EmptyParams = Record<string, never>

/**
 * Drop a single parenthesized constraint group from a param name.
 * `id(\\d+)`   → `id`
 * `id(\\d+)?`  → `id?`  (optionality marker preserved for ParamRecord)
 * `id`         → `id`   (no-op when no constraint present)
 */
type StripConstraint<P extends string> = P extends `${infer Head}(${string})${infer Tail}`
  ? `${Head}${Tail}`
  : P

type ParamRecord<P extends string> = StripConstraint<P> extends `${infer Name}?`
  ? { [K in Name]?: string }
  : { [K in StripConstraint<P>]: string }
