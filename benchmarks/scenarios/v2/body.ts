import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runScenario } from './_runner.ts'

const here = dirname(fileURLToPath(import.meta.url))
const srv = (name: string) => resolve(here, '_servers', name)

const body = JSON.stringify({ name: 'world' })
const headers = { 'content-type': 'application/json' }

await runScenario(
  'body-json (POST /echo with JSON body)',
  [
    { name: 'Express', file: srv('express-body.ts'), path: '/echo', method: 'POST', body, headers },
    { name: 'Fastify', file: srv('fastify-body.ts'), path: '/echo', method: 'POST', body, headers },
    { name: 'Hono', file: srv('hono-body.ts'), path: '/echo', method: 'POST', body, headers },
    { name: 'RiftExpress', file: srv('rift-body.ts'), path: '/echo', method: 'POST', body, headers },
  ],
)
