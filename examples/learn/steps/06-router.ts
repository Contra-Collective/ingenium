// ─────────────────────────────────────────────────────────────────────────────
//  Step 6 — Mountable routers.
//
//  Concepts:
//    • `Router()` creates a sub-app you can attach with `app.use(prefix, …)`.
//    • Routers can mount other routers — nest as deep as your domain wants.
//    • Middleware on a router only runs for requests matching its mount path.
//
//  Run:        npm run 6
//  Try it:     curl http://localhost:3000/api/health
//              curl http://localhost:3000/api/notes
//              curl -X POST http://localhost:3000/api/notes \
//                -H 'content-type: application/json' \
//                -d '{"text":"hello"}'
// ─────────────────────────────────────────────────────────────────────────────

import { ingenium, Router } from 'ingenium'

const notes: { id: number; text: string }[] = []

const notesRouter = Router()
notesRouter.get('/', () => notes)
notesRouter.post('/', async (ctx) => {
  const { text } = await ctx.body.json<{ text: string }>()
  const note = { id: notes.length + 1, text }
  notes.push(note)
  return ctx.json(note, 201)
})

const api = Router()
api.get('/health', () => ({ ok: true }))
api.use('/notes', notesRouter)

const app = ingenium()
app.use('/api', api)

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
