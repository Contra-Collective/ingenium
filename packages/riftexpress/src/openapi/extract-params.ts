import type { Parameter } from './types.ts'

/**
 * Extract OpenAPI `path` parameter descriptors from a RiftExpress route
 * pattern. Mirrors the path syntax documented in `API.md`:
 *
 * - `/users/:id`        → required string param `id`
 * - `/users/:id?`       → optional string param `id`
 * - `/files/*path`      → required string param `path` (greedy tail)
 *
 * All extracted params get `schema: { type: 'string' }` since RiftExpress
 * preserves URL segments as raw strings; consumers can override the schema
 * via `app.describe()` if they want a tighter type (e.g. integer ids).
 *
 * Pure function: deterministic, no allocations beyond the result array.
 *
 * @example
 * extractPathParams('/users/:id/posts/:slug?')
 * // [
 * //   { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
 * //   { name: 'slug', in: 'path', required: false, schema: { type: 'string' } },
 * // ]
 */
export function extractPathParams(path: string): Parameter[] {
  if (!path) return []
  const params: Parameter[] = []
  const segments = path.split('/')

  for (const seg of segments) {
    if (!seg) continue
    if (seg[0] === ':') {
      // Trim a single trailing `?` to detect optionality.
      const isOptional = seg.endsWith('?')
      const name = isOptional ? seg.slice(1, -1) : seg.slice(1)
      if (!name) continue
      params.push({
        name,
        in: 'path',
        // OpenAPI 3.1: path parameters MUST be required: true. If the route
        // declares an optional segment, the server actually accepts two
        // distinct paths (with and without the segment). For correctness in
        // generated specs, we still emit required: true and surface the
        // optionality via an `x-rift-optional` extension; tools that need it
        // can split the path themselves.
        required: !isOptional,
        schema: { type: 'string' },
        ...(isOptional ? { 'x-rift-optional': true } : {}),
      })
    } else if (seg[0] === '*') {
      const name = seg.slice(1) || 'wildcard'
      params.push({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
        'x-rift-wildcard': true,
      })
    }
  }

  return params
}
