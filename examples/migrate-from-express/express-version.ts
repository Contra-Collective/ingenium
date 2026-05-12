// Express version — the "before" snapshot.
// Run with: npm run express   (listens on http://localhost:3001)

import express, {
  type Request,
  type Response,
  type NextFunction,
  Router,
} from 'express'

const app = express()

// JSON body parsing — required up front in Express.
app.use(express.json())

// Logger middleware.
app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now()
  res_on_finish(_res, () => {
    console.log(`${req.method} ${req.path} -> ${Date.now() - start}ms`)
  })
  next()
})

function res_on_finish(res: Response, cb: () => void): void {
  res.on('finish', cb)
}

// In-memory store so POST /users has somewhere to write.
const users = new Map<string, { id: string; name: string }>()

app.get('/users/:id', (req: Request, res: Response) => {
  const user = users.get(req.params.id)
  if (!user) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json(user)
})

app.post('/users', (req: Request, res: Response) => {
  const body = req.body as { id?: unknown; name?: unknown }
  if (typeof body?.id !== 'string' || typeof body?.name !== 'string') {
    res.status(400).json({ error: 'id and name must be strings' })
    return
  }
  const user = { id: body.id, name: body.name }
  users.set(user.id, user)
  res.status(201).json(user)
})

// Sub-router mounted at /api with a health endpoint.
const api = Router()
api.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})
app.use('/api', api)

// Custom error handler — Express identifies these by 4-arg signature.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('handler error:', err)
  res.status(500).json({
    error: err instanceof Error ? err.message : 'unknown',
  })
})

app.listen(3001, () => {
  console.log('Express listening on http://localhost:3001')
})
