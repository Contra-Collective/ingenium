import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runScenario } from './_runner.ts'

const here = dirname(fileURLToPath(import.meta.url))
const srv = (name: string) => resolve(here, '_servers', name)

await runScenario(
  'middleware-stack (10 mw layers, GET /)',
  [
    { name: 'Express', file: srv('express-middleware.ts') },
    { name: 'Fastify', file: srv('fastify-middleware.ts') },
    { name: 'Hono', file: srv('hono-middleware.ts') },
    { name: 'RiftExpress', file: srv('rift-middleware.ts') },
  ],
)
