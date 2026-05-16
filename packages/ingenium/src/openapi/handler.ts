import type { IngeniumApp } from '../app.ts'
import type { IngeniumContext } from '../context/context.ts'
import type { IngeniumHandler } from '../middleware/types.ts'
import { generateOpenApi, type GenerateOpenApiOptions } from './generate.ts'
import type { OpenApiSpec } from './types.ts'

/**
 * Build a route handler that serves the generated OpenAPI spec as JSON.
 *
 * The spec is generated lazily on the first request that hits this handler
 * and cached on the app under a private symbol. The cache invalidates when
 * the registration journal length changes — i.e. when new routes are added —
 * so live-registered routes are reflected on the next request.
 *
 * @example
 * app.get('/openapi.json', ingenium.openapiHandler({
 *   info: { title: 'My API', version: '1.0.0' },
 * }))
 */
export function openapiHandler(opts: GenerateOpenApiOptions): IngeniumHandler {
  type Cache = { journalLen: number; descriptorVer: number; spec: OpenApiSpec }
  let cache: Cache | null = null

  return (ctx: IngeniumContext): void => {
    const app = resolveApp(ctx)
    if (!app) {
      // The integration shim stamps `ctx.state._ingeniumApp` for us; if it's
      // missing the user is on an older app build that hasn't applied the
      // shim. Surface a clear error rather than silently emitting an empty
      // spec.
      ctx.json(
        {
          error: 'openapiHandler: ctx.state._ingeniumApp is missing — apply the integration shim from src/_pending-context-additions/openapi.ts',
        },
        500,
      )
      return
    }

    const journalLen = readJournalLen(app)
    const descriptorVer = readDescriptorVersion(app)

    if (
      cache === null
      || cache.journalLen !== journalLen
      || cache.descriptorVer !== descriptorVer
    ) {
      cache = { journalLen, descriptorVer, spec: generateOpenApi(app, opts) }
    }
    ctx.json(cache.spec)
  }
}

/**
 * Pull the owning IngeniumApp off the context. We stash a reference under
 * `ctx.state._ingeniumApp` from the integration shim in app.ts; if it's
 * missing (older app, no integration), fall back to `ctx.state.app`.
 */
function resolveApp(ctx: IngeniumContext): IngeniumApp | null {
  const fromState = (ctx.state as Record<string, unknown>)._ingeniumApp
    ?? (ctx.state as Record<string, unknown>).app
  return (fromState as IngeniumApp | undefined) ?? null
}

function readJournalLen(app: IngeniumApp): number {
  const router = (app as unknown as { router?: { journal: unknown[] } }).router
  return router?.journal?.length ?? 0
}

function readDescriptorVersion(app: IngeniumApp): number {
  // Bumped by `app.describe()` so descriptor edits invalidate the cache too.
  return (app as unknown as { _routeDescriptorVersion?: number })._routeDescriptorVersion ?? 0
}
