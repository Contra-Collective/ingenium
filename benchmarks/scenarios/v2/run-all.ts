import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DISCLAIMER, runScenario } from './_runner.ts'

const here = dirname(fileURLToPath(import.meta.url))
const srv = (name: string) => resolve(here, '_servers', name)

console.log('')
console.log('=========================================================================')
console.log(' Ingenium bench v2 — multi-framework, multi-process, multi-sample')
console.log('=========================================================================')
console.log('')
console.log(`DISCLAIMER: ${DISCLAIMER}`)
console.log('')

const body = JSON.stringify({ name: 'world' })
const headers = { 'content-type': 'application/json' }

await runScenario(
  'hello (GET / -> {ok:true})',
  [
    { name: 'Express', file: srv('express-hello.ts') },
    { name: 'Fastify', file: srv('fastify-hello.ts') },
    { name: 'Hono', file: srv('hono-hello.ts') },
    { name: 'Ingenium', file: srv('rift-hello.ts') },
  ],
)

await runScenario(
  'body-json (POST /echo with JSON body)',
  [
    { name: 'Express', file: srv('express-body.ts'), path: '/echo', method: 'POST', body, headers },
    { name: 'Fastify', file: srv('fastify-body.ts'), path: '/echo', method: 'POST', body, headers },
    { name: 'Hono', file: srv('hono-body.ts'), path: '/echo', method: 'POST', body, headers },
    { name: 'Ingenium', file: srv('rift-body.ts'), path: '/echo', method: 'POST', body, headers },
  ],
)

await runScenario(
  'middleware-stack (10 mw layers, GET /)',
  [
    { name: 'Express', file: srv('express-middleware.ts') },
    { name: 'Fastify', file: srv('fastify-middleware.ts') },
    { name: 'Hono', file: srv('hono-middleware.ts') },
    { name: 'Ingenium', file: srv('rift-middleware.ts') },
  ],
)

console.log('')
console.log(`DISCLAIMER: ${DISCLAIMER}`)
console.log('')
