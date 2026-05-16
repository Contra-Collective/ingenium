import type { HttpMethod } from '../router/types.ts'
import type {
  Operation,
  Parameter,
  RequestBody,
  Response,
  SecurityRequirement,
} from './types.ts'

/**
 * Per-route metadata supplied via `app.describe('METHOD', '/path', meta)`.
 * Merged into the generated Operation by `generateOpenApi`.
 *
 * Anything you put here ends up on the operation object verbatim, except:
 * - `hidden: true` skips the route entirely (won't appear in the spec).
 * - `parameters` are *appended* to the path-param parameters extracted from
 *   the route syntax, so you typically only put `query`, `header`, or
 *   `cookie` parameters here.
 */
export interface RouteDescriptor {
  summary?: string
  description?: string
  operationId?: string
  tags?: string[]
  deprecated?: boolean
  hidden?: boolean
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses?: Record<string | number, Response>
  security?: SecurityRequirement[]
  /** Extension passthrough — anything starting with `x-` is preserved. */
  [extension: `x-${string}`]: unknown
}

/** Stable lookup key used by the descriptor map. */
export function descriptorKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`
}

/**
 * Merge a `RouteDescriptor` onto a base `Operation` (which already carries
 * the path parameters extracted from the route syntax). Mutates and returns
 * the base operation for caller convenience.
 *
 * Order rules:
 * - `parameters` are concatenated (path params first, descriptor params after).
 * - `responses` map keys are normalized to strings (200 → '200').
 * - Extensions (`x-*`) are copied verbatim.
 */
export function mergeDescriptor(
  base: Operation,
  desc: RouteDescriptor | undefined,
): Operation {
  if (!desc) return base
  if (desc.summary !== undefined) base.summary = desc.summary
  if (desc.description !== undefined) base.description = desc.description
  if (desc.operationId !== undefined) base.operationId = desc.operationId
  if (desc.tags !== undefined) base.tags = [...desc.tags]
  if (desc.deprecated !== undefined) base.deprecated = desc.deprecated
  if (desc.security !== undefined) base.security = desc.security
  if (desc.requestBody !== undefined) base.requestBody = desc.requestBody
  if (desc.parameters && desc.parameters.length > 0) {
    base.parameters = [...(base.parameters ?? []), ...desc.parameters]
  }
  if (desc.responses) {
    const out: Record<string, Response> = {}
    for (const k of Object.keys(desc.responses)) {
      out[String(k)] = desc.responses[k as keyof typeof desc.responses] as Response
    }
    base.responses = out
  }
  // Copy x-* extensions verbatim.
  for (const k of Object.keys(desc)) {
    if (k.startsWith('x-')) {
      ;(base as Record<string, unknown>)[k] = (desc as Record<string, unknown>)[k]
    }
  }
  return base
}
