import type { RiftexApp } from '../app.ts'
import { isStandardSchema } from '../schema/standard.ts'
import { Router, flattenRouter } from '../router/router.ts'
import type { HttpMethod } from '../router/types.ts'
import { descriptorKey, mergeDescriptor, type RouteDescriptor } from './describe.ts'
import { extractPathParams } from './extract-params.ts'
import type {
  Components,
  Info,
  MediaType,
  OpenApiSpec,
  Operation,
  PathItem,
  RequestBody,
  Response,
  Schema,
  SecurityRequirement,
  SecurityScheme,
  Server,
  Tag,
} from './types.ts'

/** Public options for `generateOpenApi(app, opts)`. */
export interface GenerateOpenApiOptions {
  info: Info
  servers?: Server[]
  tags?: Tag[]
  security?: SecurityRequirement[]
  /**
   * Auto-tag generated operations by path prefix. The longest matching
   * prefix wins. Routes that already have `tags` in their descriptor are
   * left alone.
   *
   * @example { '/users': 'users', '/auth': 'auth' }
   */
  tagsByPrefix?: Record<string, string>
  /**
   * Hide routes whose path matches any entry. Strings match exactly,
   * RegExps are tested against the full path.
   */
  excludePaths?: (string | RegExp)[]
  /** Pass-through `components.securitySchemes`. */
  securitySchemes?: Record<string, SecurityScheme>
  /**
   * Optional additional schemas to merge into `components.schemas`. Useful
   * when you reference shared models via `$ref: '#/components/schemas/X'`.
   */
  componentSchemas?: Record<string, Schema>
}

/**
 * Generate an OpenAPI 3.1 spec from a composed (or uncomposed) RiftexApp.
 * Walks the registration journal — does not require `compose()` to have run.
 *
 * Schema-conversion strategy (in priority order):
 *   1. If a request/response schema has a `toJsonSchema()` method (Zod 3.24+,
 *      ArkType, Effect Schema, etc.), call it.
 *   2. If it looks like a Standard Schema (has `~standard`), emit `{}` plus
 *      `x-schema-source: '<vendor>-untranslated'` as a TODO marker.
 *   3. Otherwise, pass the value through unchanged (assumed JSON Schema).
 */
export function generateOpenApi(
  app: RiftexApp,
  opts: GenerateOpenApiOptions,
): OpenApiSpec {
  const router = getRouter(app)
  const descriptors = getDescriptors(app)
  const flat = flattenRouter(router)

  const paths: Record<string, PathItem> = {}
  const tagsByPrefix = sortedTagsByPrefix(opts.tagsByPrefix)
  const exclude = opts.excludePaths ?? []

  for (const route of flat.routes) {
    if (isExcluded(route.path, exclude)) continue

    const desc = descriptors.get(descriptorKey(route.method, route.path))
    if (desc?.hidden) continue

    const oasPath = toOpenApiPath(route.path)
    const item: PathItem = paths[oasPath] ?? (paths[oasPath] = {})

    const op: Operation = {
      parameters: extractPathParams(route.path),
      responses: { default: { description: 'Default response' } },
    }

    // Auto-tag by prefix if no descriptor tags were provided.
    if (!desc?.tags) {
      const tag = matchTag(route.path, tagsByPrefix)
      if (tag) op.tags = [tag]
    }

    mergeDescriptor(op, desc)

    // Convert any Standard/Zod-style schemas inside requestBody.content.
    if (op.requestBody) {
      op.requestBody = convertRequestBodySchemas(op.requestBody)
    }
    if (op.responses) {
      const r: Record<string, Response> = {}
      for (const k of Object.keys(op.responses)) {
        r[k] = convertResponseSchemas(op.responses[k]!)
      }
      op.responses = r
    }

    // PathItem's method keys are typed as Operation but `keyof PathItem` widens
    // to include `parameters` / `summary` / `description`. Cast the slot.
    ;(item as Record<string, Operation>)[methodKey(route.method)] = op
  }

  const components: Components = {}
  if (opts.securitySchemes) components.securitySchemes = opts.securitySchemes
  if (opts.componentSchemas) components.schemas = opts.componentSchemas

  const spec: OpenApiSpec = {
    openapi: '3.1.0',
    info: opts.info,
    paths,
  }
  if (opts.servers) spec.servers = opts.servers
  if (opts.tags) spec.tags = opts.tags
  if (opts.security) spec.security = opts.security
  if (Object.keys(components).length > 0) spec.components = components

  return spec
}

// ───── helpers ──────────────────────────────────────────────────────────────

/** Reach into the app's private `router` field — public surface intentionally narrow. */
function getRouter(app: RiftexApp): Router {
  const r = (app as unknown as { router?: Router })['router']
  if (!(r instanceof Router)) {
    throw new TypeError(
      'generateOpenApi: app.router is not a Router instance — pass the value returned by `riftex()`.',
    )
  }
  return r
}

/** Reach into the descriptor map (set up by the integration in app.ts). */
function getDescriptors(app: RiftexApp): Map<string, RouteDescriptor> {
  const m = (app as unknown as { _routeDescriptors?: Map<string, RouteDescriptor> })['_routeDescriptors']
  return m instanceof Map ? m : new Map()
}

/** Convert RiftExpress path syntax to OpenAPI: `:id` → `{id}`, `*path` → `{path}`. */
function toOpenApiPath(path: string): string {
  if (!path) return '/'
  const out = path
    .split('/')
    .map((seg) => {
      if (!seg) return seg
      if (seg[0] === ':') {
        const isOpt = seg.endsWith('?')
        const name = isOpt ? seg.slice(1, -1) : seg.slice(1)
        return `{${name}}`
      }
      if (seg[0] === '*') {
        const name = seg.slice(1) || 'wildcard'
        return `{${name}}`
      }
      return seg
    })
    .join('/')
  return out || '/'
}

function methodKey(m: HttpMethod): keyof PathItem {
  return m.toLowerCase() as keyof PathItem
}

function isExcluded(path: string, excludes: (string | RegExp)[]): boolean {
  for (const ex of excludes) {
    if (typeof ex === 'string') {
      if (ex === path) return true
    } else if (ex.test(path)) {
      return true
    }
  }
  return false
}

function sortedTagsByPrefix(map: Record<string, string> | undefined): [string, string][] {
  if (!map) return []
  return Object.entries(map).sort((a, b) => b[0].length - a[0].length)
}

function matchTag(path: string, tagsByPrefix: [string, string][]): string | undefined {
  for (const [prefix, tag] of tagsByPrefix) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix)) {
      return tag
    }
  }
  return undefined
}

function convertRequestBodySchemas(rb: RequestBody): RequestBody {
  const out: RequestBody = { ...rb, content: {} }
  for (const [type, media] of Object.entries(rb.content)) {
    out.content[type] = convertMediaSchema(media)
  }
  return out
}

function convertResponseSchemas(res: Response): Response {
  if (!res.content) return res
  const next: Response = { ...res, content: {} }
  for (const [type, media] of Object.entries(res.content)) {
    next.content![type] = convertMediaSchema(media)
  }
  return next
}

function convertMediaSchema(media: MediaType): MediaType {
  if (!media.schema) return media
  const converted = toJsonSchema(media.schema)
  if (converted === media.schema) return media
  return { ...media, schema: converted }
}

/**
 * Best-effort schema conversion. Returns the input unchanged if it's already
 * a plain JSON Schema; otherwise tries known conversion paths.
 */
function toJsonSchema(schema: unknown): Schema {
  if (schema === null || typeof schema !== 'object') return schema as Schema

  // 1. Native `toJsonSchema()` (Zod 3.24+, ArkType, Effect Schema, etc.)
  const maybe = schema as { toJsonSchema?: () => unknown }
  if (typeof maybe.toJsonSchema === 'function') {
    try {
      const out = maybe.toJsonSchema()
      if (out && typeof out === 'object') return out as Schema
    } catch {
      // fall through to placeholder
    }
  }

  // 2. Standard Schema fallback — emit a marker so users know to add a
  //    converter. We can't introspect the validator without running it.
  if (isStandardSchema(schema)) {
    const vendor = schema['~standard'].vendor || 'unknown'
    return { 'x-schema-source': `${vendor}-untranslated` }
  }

  // 3. Pass through (assumed JSON Schema literal).
  return schema as Schema
}
