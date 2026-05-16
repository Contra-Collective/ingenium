import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runScenario } from './_runner.ts'

const here = dirname(fileURLToPath(import.meta.url))
const srv = (name: string) => resolve(here, '_servers', name)

await runScenario(
  'hello (GET / -> {ok:true})',
  [
    { name: 'Express', file: srv('express-hello.ts') },
    { name: 'Fastify', file: srv('fastify-hello.ts') },
    { name: 'Hono', file: srv('hono-hello.ts') },
    { name: 'Ingenium', file: srv('rift-hello.ts') },
  ],
)
