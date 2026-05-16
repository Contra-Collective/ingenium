/**
 * Sinatra-style top-level shorthand.
 *
 * Lets users skip the app object entirely:
 *
 * ```ts
 * import { get, post, listen } from 'ingenium'
 *
 * get('/', () => 'hi')
 * get('/users/:id', (ctx) => ({ id: ctx.params.id }))
 * post('/echo', async (ctx) => ctx.body.json())
 *
 * await listen(3000)
 * ```
 *
 * All exported verbs route to a lazy singleton `IngeniumApp` created on first
 * call. The instance is retained for the lifetime of the process; tests can
 * call `_resetDefaultApp()` to drop it (this throws in production).
 */

import { IngeniumApp, type IngeniumErrorHandler } from '../app.ts'
import type { IngeniumHandler, IngeniumMiddleware } from '../middleware/types.ts'
import { Router } from '../router/router.ts'
import type { ListeningServer } from '../transport/types.ts'

let _defaultApp: IngeniumApp | null = null

/**
 * Get the lazy default app. Created on first call, retained for the
 * lifetime of the process (or until `_resetDefaultApp()` is invoked).
 *
 * The same instance is returned on every subsequent call, so all
 * top-level verb functions and `listen()` operate on a single coherent
 * registration journal.
 */
export function defaultApp(): IngeniumApp {
  if (!_defaultApp) _defaultApp = new IngeniumApp()
  return _defaultApp
}

/**
 * Reset the default app — for tests only. The next call to any top-level
 * function will lazily create a fresh `IngeniumApp`. Throws when
 * `NODE_ENV === 'production'` so accidental production calls are loud.
 */
export function _resetDefaultApp(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('_resetDefaultApp is a test-only API')
  }
  _defaultApp = null
}

// ───── HTTP verb shorthand ──────────────────────────────────────────────────
//
// Signatures mirror `IngeniumApp.get/post/...` exactly (`(path, handler)`),
// so the typed-ctx story (e.g. `IngeniumHandler<{ id: string }>`) is preserved
// for users who import these as drop-in replacements for `app.get(...)`.

export function get(path: string, handler: IngeniumHandler): IngeniumApp {
  return defaultApp().get(path, handler)
}

export function post(path: string, handler: IngeniumHandler): IngeniumApp {
  return defaultApp().post(path, handler)
}

export function put(path: string, handler: IngeniumHandler): IngeniumApp {
  return defaultApp().put(path, handler)
}

export function patch(path: string, handler: IngeniumHandler): IngeniumApp {
  return defaultApp().patch(path, handler)
}

/**
 * Default-app shorthand for `app.delete(path, handler)`.
 * Exported as `del` because `delete` is a reserved word in JavaScript and
 * cannot be used as a top-level identifier. `index.ts` re-exports this as
 * `{ del as delete }` so the public name is `delete`.
 */
export function del(path: string, handler: IngeniumHandler): IngeniumApp {
  return defaultApp().delete(path, handler)
}

export function head(path: string, handler: IngeniumHandler): IngeniumApp {
  return defaultApp().head(path, handler)
}

export function options(path: string, handler: IngeniumHandler): IngeniumApp {
  return defaultApp().options(path, handler)
}

// ───── use / onError / listen ───────────────────────────────────────────────

/**
 * Mount middleware on the default app. Same overload set as `app.use`:
 *   - `use(mw)` — global
 *   - `use(prefix, mw | Router)` — prefix-scoped
 */
export function use(mw: IngeniumMiddleware): IngeniumApp
export function use(prefix: string, mw: IngeniumMiddleware | Router): IngeniumApp
export function use(
  arg1: string | IngeniumMiddleware,
  arg2?: IngeniumMiddleware | Router,
): IngeniumApp {
  const app = defaultApp()
  if (typeof arg1 === 'string') {
    return app.use(arg1, arg2 as IngeniumMiddleware | Router)
  }
  return app.use(arg1)
}

/** Default-app shorthand for `app.onError(handler)`. */
export function onError(handler: IngeniumErrorHandler): IngeniumApp {
  return defaultApp().onError(handler)
}

/**
 * Bind the default app to a port. Returns a `ListeningServer` whose
 * `.close()` shuts down the underlying transport. Pass `0` for an
 * ephemeral port (useful in tests).
 */
export function listen(port: number, host?: string): Promise<ListeningServer> {
  return host !== undefined ? defaultApp().listen(port, host) : defaultApp().listen(port)
}

// ───── Sinatra-style filter shorthand ───────────────────────────────────────
//
// Mirrors `IngeniumApp.before/after` overloads exactly.

export function before(handler: IngeniumMiddleware): IngeniumApp
export function before(pattern: string, handler: IngeniumMiddleware): IngeniumApp
export function before(
  arg1: string | IngeniumMiddleware,
  arg2?: IngeniumMiddleware,
): IngeniumApp {
  const app = defaultApp()
  if (typeof arg1 === 'string') return app.before(arg1, arg2 as IngeniumMiddleware)
  return app.before(arg1)
}

export function after(handler: IngeniumMiddleware): IngeniumApp
export function after(pattern: string, handler: IngeniumMiddleware): IngeniumApp
export function after(
  arg1: string | IngeniumMiddleware,
  arg2?: IngeniumMiddleware,
): IngeniumApp {
  const app = defaultApp()
  if (typeof arg1 === 'string') return app.after(arg1, arg2 as IngeniumMiddleware)
  return app.after(arg1)
}
