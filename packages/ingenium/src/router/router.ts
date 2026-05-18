import type { IngeniumHandler, IngeniumMiddleware } from '../middleware/types.ts'
import type { ExtractParams, HttpMethod } from './types.ts'

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

  get<P extends string>(path: P, handler: IngeniumHandler<ExtractParams<P>>): this
  get<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  get<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this {
    return this.method('GET', path, ...(args as [...IngeniumMiddleware[], IngeniumHandler]))
  }
  post<P extends string>(path: P, handler: IngeniumHandler<ExtractParams<P>>): this
  post<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  post<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this {
    return this.method('POST', path, ...(args as [...IngeniumMiddleware[], IngeniumHandler]))
  }
  put<P extends string>(path: P, handler: IngeniumHandler<ExtractParams<P>>): this
  put<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  put<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this {
    return this.method('PUT', path, ...(args as [...IngeniumMiddleware[], IngeniumHandler]))
  }
  patch<P extends string>(path: P, handler: IngeniumHandler<ExtractParams<P>>): this
  patch<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  patch<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this {
    return this.method('PATCH', path, ...(args as [...IngeniumMiddleware[], IngeniumHandler]))
  }
  delete<P extends string>(path: P, handler: IngeniumHandler<ExtractParams<P>>): this
  delete<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  delete<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this {
    return this.method('DELETE', path, ...(args as [...IngeniumMiddleware[], IngeniumHandler]))
  }
  head<P extends string>(path: P, handler: IngeniumHandler<ExtractParams<P>>): this
  head<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  head<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this {
    return this.method('HEAD', path, ...(args as [...IngeniumMiddleware[], IngeniumHandler]))
  }
  options<P extends string>(path: P, handler: IngeniumHandler<ExtractParams<P>>): this
  options<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  options<P extends string>(path: P, ...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this {
    return this.method('OPTIONS', path, ...(args as [...IngeniumMiddleware[], IngeniumHandler]))
  }

  /**
   * Chainable per-path registration. Returns a builder that holds the path
   * and lets you stack verbs on it without retyping:
   *
   * @example
   *   router
   *     .route('/users/:id')
   *     .get((ctx) => loadUser(ctx.params.id))
   *     .put(requireAdmin, (ctx) => updateUser(ctx))
   *     .delete(requireAdmin, (ctx) => deleteUser(ctx))
   *
   * Pure registration sugar — every call delegates to `router.method(...)`,
   * so all features (inline middleware, declarative options, typed params
   * via `ExtractParams<P>`) work identically.
   */
  route<P extends string>(path: P): RouteBuilder<P> {
    return new RouteBuilder<P>((method, args) =>
      (this.method as (m: HttpMethod, p: string, ...a: unknown[]) => unknown)(method, path, ...args),
    )
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

/**
 * Per-path chainable builder returned by `app.route(path)` and
 * `router.route(path)`. Holds the path and an "emit" callback that registers
 * a route on the underlying host (an `IngeniumApp` or a `Router`); the
 * builder itself is just sugar — no per-request cost, no separate dispatch
 * path. The host's verb method does all the validation, dirty-bit flipping,
 * and journal writes.
 *
 * The generic `P` flows `ExtractParams<P>` into every handler signature so
 * `app.route('/users/:id').get(ctx => ctx.params.id)` narrows `ctx.params`
 * exactly like the bare verb form does.
 */
export class RouteBuilder<P extends string> {
  constructor(private readonly emit: (method: HttpMethod, args: unknown[]) => void) {}

  get(handler: IngeniumHandler<ExtractParams<P>>): this
  get(...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  get(...args: unknown[]): this { this.emit('GET', args); return this }

  post(handler: IngeniumHandler<ExtractParams<P>>): this
  post(...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  post(...args: unknown[]): this { this.emit('POST', args); return this }

  put(handler: IngeniumHandler<ExtractParams<P>>): this
  put(...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  put(...args: unknown[]): this { this.emit('PUT', args); return this }

  patch(handler: IngeniumHandler<ExtractParams<P>>): this
  patch(...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  patch(...args: unknown[]): this { this.emit('PATCH', args); return this }

  delete(handler: IngeniumHandler<ExtractParams<P>>): this
  delete(...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  delete(...args: unknown[]): this { this.emit('DELETE', args); return this }

  head(handler: IngeniumHandler<ExtractParams<P>>): this
  head(...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  head(...args: unknown[]): this { this.emit('HEAD', args); return this }

  options(handler: IngeniumHandler<ExtractParams<P>>): this
  options(...args: [...IngeniumMiddleware[], IngeniumHandler<ExtractParams<P>>]): this
  options(...args: unknown[]): this { this.emit('OPTIONS', args); return this }

  /** Register the same handler for all common HTTP methods (GET, POST, PUT, PATCH, DELETE). */
  all(handler: IngeniumHandler<ExtractParams<P>>): this {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) this.emit(m, [handler])
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
