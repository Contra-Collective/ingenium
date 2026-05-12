// End-to-end integration test. Boots the real app on an ephemeral port,
// hits it via fetch, asserts the wire contract. Each test gets a fresh DB
// file in the OS tmp dir; teardown closes the server, the DB, and unlinks
// the file. No global state.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from 'pino'
import type { ListeningServer } from 'riftexpress'
import { buildApp } from '../src/index.ts'
import { openDatabase, type DB } from '../src/db.ts'
import { createLogger } from '../src/logger.ts'
import { loadConfig } from '../src/config.ts'

interface Harness {
  server: ListeningServer
  db: DB
  logger: Logger
  baseUrl: string
  tmpDir: string
}

let h: Harness

async function boot(): Promise<Harness> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'notes-api-'))
  const dbFile = join(tmpDir, 'notes.db')
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_FILE: dbFile })
  const logger = createLogger({ level: 'silent', enabled: false })
  const db = openDatabase(dbFile)
  const app = await buildApp({ config, db, logger })
  const server = await app.listen(0)
  return { server, db, logger, baseUrl: `http://127.0.0.1:${server.port}`, tmpDir }
}

beforeEach(async () => {
  h = await boot()
})

afterEach(async () => {
  await h.server.close({ gracefulTimeoutMs: 1_000 })
  h.db.close()
  rmSync(h.tmpDir, { recursive: true, force: true })
})

interface SignupResp {
  user: { id: string; email: string; display_name: string; created_at: number }
  token: string
}

async function signup(email: string, name = 'Test User'): Promise<SignupResp> {
  const res = await fetch(`${h.baseUrl}/api/users/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, display_name: name }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as SignupResp
}

function authed(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` }
}

describe('notes-api integration', () => {
  test('health endpoint reports db up', async () => {
    const res = await fetch(`${h.baseUrl}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; db: string; version: string }
    expect(body.ok).toBe(true)
    expect(body.db).toBe('up')
    expect(body.version).toBeDefined()
  })

  test('full lifecycle: signup, token, create, list, get, update, delete', async () => {
    const { user, token } = await signup('alice@example.com', 'Alice')

    // /me reflects the authenticated user.
    const me = await fetch(`${h.baseUrl}/api/users/me`, { headers: authed(token) })
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { user: { id: string; email: string } }
    expect(meBody.user.id).toBe(user.id)
    expect(meBody.user.email).toBe('alice@example.com')

    // Issue a second token via /tokens.
    const tokRes = await fetch(`${h.baseUrl}/api/users/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    })
    expect(tokRes.status).toBe(201)
    const tokBody = (await tokRes.json()) as { token: string }
    expect(tokBody.token).toMatch(/^tok_/)

    // Create a note.
    const create = await fetch(`${h.baseUrl}/api/notes`, {
      method: 'POST',
      headers: authed(token),
      body: JSON.stringify({ title: 'First', body: 'Hello world', tags: ['work', 'work', 'urgent'] }),
    })
    expect(create.status).toBe(201)
    const note = (await create.json()) as {
      id: string
      title: string
      tags: string[]
    }
    expect(note.title).toBe('First')
    expect(note.tags.sort()).toEqual(['urgent', 'work']) // dedup + sort by stored order

    // List sees the note.
    const list = await fetch(`${h.baseUrl}/api/notes`, { headers: authed(token) })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as { items: { id: string }[]; count: number }
    expect(listBody.count).toBe(1)
    expect(listBody.items[0]?.id).toBe(note.id)

    // List with tag filter.
    const tagged = await fetch(`${h.baseUrl}/api/notes?tag=urgent`, { headers: authed(token) })
    const taggedBody = (await tagged.json()) as { count: number }
    expect(taggedBody.count).toBe(1)

    // Search hits the note.
    const search = await fetch(`${h.baseUrl}/api/notes?q=hello`, { headers: authed(token) })
    const searchBody = (await search.json()) as { count: number }
    expect(searchBody.count).toBe(1)

    // Get single.
    const single = await fetch(`${h.baseUrl}/api/notes/${note.id}`, { headers: authed(token) })
    expect(single.status).toBe(200)

    // Patch title.
    const patch = await fetch(`${h.baseUrl}/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: authed(token),
      body: JSON.stringify({ title: 'First (revised)' }),
    })
    expect(patch.status).toBe(200)
    const patched = (await patch.json()) as { title: string; tags: string[] }
    expect(patched.title).toBe('First (revised)')
    expect(patched.tags.sort()).toEqual(['urgent', 'work']) // tags untouched on partial patch

    // Delete.
    const del = await fetch(`${h.baseUrl}/api/notes/${note.id}`, {
      method: 'DELETE',
      headers: authed(token),
    })
    expect(del.status).toBe(204)

    // Now 404.
    const after = await fetch(`${h.baseUrl}/api/notes/${note.id}`, { headers: authed(token) })
    expect(after.status).toBe(404)
  })

  test('user A cannot see user B notes (404, not 403)', async () => {
    const a = await signup('a@example.com', 'A')
    const b = await signup('b@example.com', 'B')

    const created = await fetch(`${h.baseUrl}/api/notes`, {
      method: 'POST',
      headers: authed(a.token),
      body: JSON.stringify({ title: 'A secret', body: 'shh' }),
    })
    const note = (await created.json()) as { id: string }

    const peek = await fetch(`${h.baseUrl}/api/notes/${note.id}`, { headers: authed(b.token) })
    expect(peek.status).toBe(404)

    const list = await fetch(`${h.baseUrl}/api/notes`, { headers: authed(b.token) })
    const body = (await list.json()) as { count: number }
    expect(body.count).toBe(0)
  })

  test('missing token → 401', async () => {
    const res = await fetch(`${h.baseUrl}/api/notes`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('UNAUTHORIZED')
  })

  test('bad token → 401', async () => {
    const res = await fetch(`${h.baseUrl}/api/notes`, {
      headers: { authorization: 'Bearer not-a-real-token' },
    })
    expect(res.status).toBe(401)
  })

  test('invalid signup body → 422 with field errors', async () => {
    const res = await fetch(`${h.baseUrl}/api/users/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', display_name: '' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { code: string; fields: Record<string, string> }
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(Object.keys(body.fields).length).toBeGreaterThan(0)
  })
})
