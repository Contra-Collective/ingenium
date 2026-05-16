/**
 * Minimal OpenAPI 3.1 type surface — just enough for what Ingenium
 * generates today. Not a full mirror of the spec; we keep it intentionally
 * narrow so the generator's outputs typecheck without dragging in a
 * 4000-line ambient module.
 *
 * Spec reference: https://spec.openapis.org/oas/v3.1.0
 *
 * Intentional gaps (out of scope for v0.0.1, document-as-TODO):
 * - `callbacks`, `links`, `webhooks` — none of these have a registration
 *   surface in Ingenium yet.
 * - `discriminator` / `xml` — schema is passed through verbatim, so callers
 *   can include these themselves if they want to.
 * - `pathItems` under `components` — we only emit operations under `paths`.
 */

/** Permissive `$ref`-or-inline union used in many slots. */
export type Ref<T> = T | { $ref: string }

/** A JSON Schema fragment (per OpenAPI 3.1 = full JSON Schema 2020-12). */
export type Schema = Record<string, unknown>

/** Where a parameter lives. Ingenium only emits `path` from route syntax. */
export type ParameterLocation = 'query' | 'header' | 'path' | 'cookie'

export interface Parameter {
  name: string
  in: ParameterLocation
  description?: string
  required?: boolean
  deprecated?: boolean
  schema?: Schema
  example?: unknown
  examples?: Record<string, Example>
  /** Free-form passthrough so callers can stamp `x-*` extensions. */
  [extension: `x-${string}`]: unknown
}

export interface Example {
  summary?: string
  description?: string
  value?: unknown
  externalValue?: string
}

export interface MediaType {
  schema?: Schema
  example?: unknown
  examples?: Record<string, Example>
}

export interface RequestBody {
  description?: string
  required?: boolean
  content: Record<string, MediaType>
}

export interface Response {
  description: string
  headers?: Record<string, Ref<Header>>
  content?: Record<string, MediaType>
}

export interface Header {
  description?: string
  required?: boolean
  deprecated?: boolean
  schema?: Schema
}

export interface SecurityRequirement {
  [name: string]: string[]
}

export interface Operation {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses?: Record<string, Response>
  deprecated?: boolean
  security?: SecurityRequirement[]
  /** Free-form passthrough so callers can stamp `x-*` extensions. */
  [extension: `x-${string}`]: unknown
}

export type PathItem = Partial<Record<
  'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace',
  Operation
>> & {
  summary?: string
  description?: string
  parameters?: Parameter[]
}

export interface Server {
  url: string
  description?: string
  variables?: Record<string, { default: string; enum?: string[]; description?: string }>
}

export interface Tag {
  name: string
  description?: string
}

export interface Info {
  title: string
  version: string
  description?: string
  termsOfService?: string
  contact?: { name?: string; url?: string; email?: string }
  license?: { name: string; url?: string; identifier?: string }
  summary?: string
}

export interface Components {
  schemas?: Record<string, Schema>
  responses?: Record<string, Response>
  parameters?: Record<string, Parameter>
  examples?: Record<string, Example>
  requestBodies?: Record<string, RequestBody>
  headers?: Record<string, Header>
  securitySchemes?: Record<string, SecurityScheme>
}

/**
 * Loose security-scheme type — we do not interpret this, we pass it through
 * verbatim to `components.securitySchemes`. Use the OpenAPI spec's full
 * shape (apiKey / http / oauth2 / openIdConnect / mutualTLS).
 */
export type SecurityScheme = Record<string, unknown>

export interface OpenApiSpec {
  openapi: '3.1.0'
  info: Info
  servers?: Server[]
  paths: Record<string, PathItem>
  components?: Components
  security?: SecurityRequirement[]
  tags?: Tag[]
  externalDocs?: { url: string; description?: string }
}
