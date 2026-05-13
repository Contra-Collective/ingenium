// Bearer-token authentication plugin.
//
// Tokens are opaque strings stored in the `tokens` table. The plugin attaches:
//   - `ctx.user`        — lazy lookup; returns null when no/invalid token
//   - `ctx.requireAuth()` — guard that throws 401 if `ctx.user` is null
// The plugin uses module augmentation so handlers see the typed surface.

import { RiftexUnauthorizedError, type RiftexPlugin } from 'riftexpress'
import { prepared, type DB } from './db.ts'

export interface AuthUser {
  id: string
  email: string
  display_name: string
  created_at: number
}

declare module 'riftexpress' {
  interface RiftexContext {
    user: AuthUser | null
    /** Throws RiftexUnauthorizedError unless a valid bearer token is presented. */
    requireAuth: () => AuthUser
  }
}

export interface AuthPluginOpts {
  db: DB
}

const BEARER = /^Bearer\s+(.+)$/i

export const authPlugin: RiftexPlugin<AuthPluginOpts> = (app, opts) => {
  const stmts = prepared(opts.db)

  // Lazy: most requests don't read `ctx.user` (think /health). When they do,
  // the lookup is one indexed primary-key fetch — cheap to do per-request.
  app.decorate('user', (ctx) => {
    const header = ctx.headers['authorization']
    if (typeof header !== 'string') return null
    const m = BEARER.exec(header)
    if (!m || !m[1]) return null
    const row = stmts.findUserByToken.get(m[1]) as AuthUser | undefined
    return row ?? null
  })

  app.decorate('requireAuth', (ctx) => (): AuthUser => {
    const u = ctx.user
    if (!u) throw new RiftexUnauthorizedError('Authentication required')
    return u
  })
}
