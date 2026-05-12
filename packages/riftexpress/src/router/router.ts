import type { RexHandler, RexMiddleware } from '../middleware/types.ts'
import type { HttpMethod } from './types.ts'

/** A journal entry — replayed against the trie when the app composes. */
export type Registration =
  | { kind: 'use-global'; mw: RexMiddleware }
  | { kind: 'use-prefix'; prefix: string; mw: RexMiddleware }
  | { kind: 'use-router'; prefix: string; router: Router }
  | { kind: 'route'; method: HttpMethod; path: string; handler: RexHandler }

/**
 * A mountable router. Registrations are journaled, not eagerly composed —
 * mounting via `app.use('/api', router)` replays this journal into the
 * parent's trie with the prefix prepended.
 */
export class Router {
  /** @internal */ readonly journal: Registration[] = []

  /** Add middleware that runs for every request below this router. */
  use(mw: RexMiddleware): this
  /** Mount middleware or a sub-router at a path prefix. */
  use(prefix: string, mw: RexMiddleware | Router): this
  use(arg1: string | RexMiddleware, arg2?: RexMiddleware | Router): this {
    if (typeof arg1 === 'string') {
      const prefix = normalizePrefix(arg1)
      if (arg2 instanceof Router) {
        this.journal.push({ kind: 'use-router', prefix, router: arg2 })
      } else if (typeof arg2 === 'function') {
        this.journal.push({ kind: 'use-prefix', prefix, mw: arg2 })
      } else {
        throw new TypeError(`Router.use(prefix, value): value must be a middleware function or a Router`)
      }
    } else if (typeof arg1 === 'function') {
      this.journal.push({ kind: 'use-global', mw: arg1 })
    } else {
      throw new TypeError(`Router.use(): first argument must be a path string or middleware function`)
    }
    return this
  }

  get<P extends string>(path: P, handler: RexHandler): this {
    return this.method('GET', path, handler)
  }
  post<P extends string>(path: P, handler: RexHandler): this {
    return this.method('POST', path, handler)
  }
  put<P extends string>(path: P, handler: RexHandler): this {
    return this.method('PUT', path, handler)
  }
  patch<P extends string>(path: P, handler: RexHandler): this {
    return this.method('PATCH', path, handler)
  }
  delete<P extends string>(path: P, handler: RexHandler): this {
    return this.method('DELETE', path, handler)
  }
  head<P extends string>(path: P, handler: RexHandler): this {
    return this.method('HEAD', path, handler)
  }
  options<P extends string>(path: P, handler: RexHandler): this {
    return this.method('OPTIONS', path, handler)
  }

  /** Internal — register a route under any HTTP method. */
  method(method: HttpMethod, path: string, handler: RexHandler): this {
    this.journal.push({ kind: 'route', method, path: normalizePath(path), handler })
    return this
  }
}

/** Strip trailing slash; ensure leading slash. Empty string is allowed (means "no prefix"). */
function normalizePrefix(p: string): string {
  if (p === '' || p === '/') return ''
  let out = p
  if (out[0] !== '/') out = '/' + out
  if (out.length > 1 && out[out.length - 1] === '/') out = out.slice(0, -1)
  return out
}

function normalizePath(p: string): string {
  if (!p) return '/'
  if (p[0] !== '/') return '/' + p
  return p
}

/**
 * Flatten a router's journal into resolved registrations against the parent,
 * applying the given prefix and inheriting any router-scoped middleware.
 *
 * Returns:
 *   - global middleware to apply to ALL routes inside the prefix
 *   - prefix-scoped middleware (with its own sub-prefix relative to root)
 *   - routes with their final composed paths
 *
 * Used by the App at compose time.
 */
export interface FlatRegistrations {
  globalMiddleware: RexMiddleware[]              // unscoped (matches every request)
  scopedMiddleware: { prefix: string; mw: RexMiddleware }[]
  routes: { method: HttpMethod; path: string; handler: RexHandler }[]
}

export function flattenRouter(router: Router, prefix: string = ''): FlatRegistrations {
  const out: FlatRegistrations = { globalMiddleware: [], scopedMiddleware: [], routes: [] }
  flattenInto(router, prefix, out)
  return out
}

function flattenInto(router: Router, prefix: string, out: FlatRegistrations): void {
  for (const entry of router.journal) {
    switch (entry.kind) {
      case 'use-global':
        // A "global" registration inside a mounted router is actually scoped to the mount prefix.
        if (prefix === '') out.globalMiddleware.push(entry.mw)
        else out.scopedMiddleware.push({ prefix, mw: entry.mw })
        break
      case 'use-prefix':
        out.scopedMiddleware.push({ prefix: prefix + entry.prefix, mw: entry.mw })
        break
      case 'use-router':
        flattenInto(entry.router, prefix + entry.prefix, out)
        break
      case 'route':
        out.routes.push({
          method: entry.method,
          path: prefix + entry.path,
          handler: entry.handler,
        })
        break
    }
  }
}
