import type { IngeniumHandler, IngeniumMiddleware } from '../middleware/types.ts'
import type { HttpMethod } from './types.ts'

/** A journal entry — replayed against the trie when the app composes. */
export type Registration =
  | { kind: 'use-global'; mw: IngeniumMiddleware }
  | { kind: 'use-prefix'; prefix: string; mw: IngeniumMiddleware }
  | { kind: 'use-router'; prefix: string; router: Router }
  | {
      kind: 'route'
      method: HttpMethod
      path: string
      handler: IngeniumHandler
      /**
       * Inline middleware passed positionally to `app.get(path, mw1, mw2, handler)`
       * (and the equivalent declarative-options form on `IngeniumApp`). Spliced into
       * the composed chain AFTER global + scoped middleware AND BEFORE the handler.
       * `undefined` for the back-compat single-arg form.
       */
      inlineMiddleware?: IngeniumMiddleware[]
    }

/**
 * Variadic route-arg shape: zero or more middleware followed by exactly one
 * handler at the tail. The TypeScript trick `[...IngeniumMiddleware[], IngeniumHandler]`
 * forces the tail position to be the handler while everything before it is
 * middleware — preserves Express's `app.get(path, ...mw, handler)` ergonomics.
 */
export type RouteArgs<P = Record<string, string>> =
  | [IngeniumHandler<P>]
  | [...IngeniumMiddleware[], IngeniumHandler<P>]

/**
 * A mountable router. Registrations are journaled, not eagerly composed —
 * mounting via `app.use('/api', router)` replays this journal into the
 * parent's trie with the prefix prepended.
 */
export class Router {
  /** @internal */ readonly journal: Registration[] = []

  /** Add middleware that runs for every request below this router. */
  use(mw: IngeniumMiddleware): this
  /** Mount middleware or a sub-router at a path prefix. */
  use(prefix: string, mw: IngeniumMiddleware | Router): this
  use(arg1: string | IngeniumMiddleware, arg2?: IngeniumMiddleware | Router): this {
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

  // ───── Verb registration ──────────────────────────────────────────────
  // Each verb supports the back-compat `(path, handler)` shape AND the
  // variadic `(path, ...inlineMiddleware, handler)` shape Express uses. The
  // overloads keep TypeScript happy with the "handler is always last" rule.

  get<P extends string>(path: P, handler: IngeniumHandler): this
  get<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  get<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    return this.method('GET', path, ...args)
  }
  post<P extends string>(path: P, handler: IngeniumHandler): this
  post<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  post<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    return this.method('POST', path, ...args)
  }
  put<P extends string>(path: P, handler: IngeniumHandler): this
  put<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  put<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    return this.method('PUT', path, ...args)
  }
  patch<P extends string>(path: P, handler: IngeniumHandler): this
  patch<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  patch<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    return this.method('PATCH', path, ...args)
  }
  delete<P extends string>(path: P, handler: IngeniumHandler): this
  delete<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  delete<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    return this.method('DELETE', path, ...args)
  }
  head<P extends string>(path: P, handler: IngeniumHandler): this
  head<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  head<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    return this.method('HEAD', path, ...args)
  }
  options<P extends string>(path: P, handler: IngeniumHandler): this
  options<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  options<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    return this.method('OPTIONS', path, ...args)
  }

  /**
   * Internal — register a route under any HTTP method. Accepts the variadic
   * `(...inlineMiddleware, handler)` tail; the LAST positional arg is always
   * the handler.
   */
  method(method: HttpMethod, path: string, handler: IngeniumHandler): this
  method(method: HttpMethod, path: string, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this
  method(method: HttpMethod, path: string, ...args: [...IngeniumMiddleware[], IngeniumHandler]): this {
    if (args.length === 0) {
      throw new TypeError(`Router.${method.toLowerCase()}('${path}'): handler is required`)
    }
    const handler = args[args.length - 1] as IngeniumHandler
    if (typeof handler !== 'function') {
      throw new TypeError(
        `Router.${method.toLowerCase()}('${path}'): last argument must be a handler function`,
      )
    }
    const inline = args.slice(0, -1) as IngeniumMiddleware[]
    for (let i = 0; i < inline.length; i++) {
      if (typeof inline[i] !== 'function') {
        throw new TypeError(
          `Router.${method.toLowerCase()}('${path}'): inline middleware at position ${i} is not a function`,
        )
      }
    }
    const entry: Registration = {
      kind: 'route',
      method,
      path: normalizePath(path),
      handler,
    }
    if (inline.length > 0) entry.inlineMiddleware = inline
    this.journal.push(entry)
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
  globalMiddleware: IngeniumMiddleware[]              // unscoped (matches every request)
  scopedMiddleware: { prefix: string; mw: IngeniumMiddleware }[]
  routes: {
    method: HttpMethod
    path: string
    handler: IngeniumHandler
    /** Inline middleware survives the flatten so app.compose() can splice it in. */
    inlineMiddleware?: IngeniumMiddleware[]
  }[]
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
      case 'route': {
        const route: FlatRegistrations['routes'][number] = {
          method: entry.method,
          path: prefix + entry.path,
          handler: entry.handler,
        }
        if (entry.inlineMiddleware && entry.inlineMiddleware.length > 0) {
          route.inlineMiddleware = entry.inlineMiddleware
        }
        out.routes.push(route)
        break
      }
    }
  }
}
