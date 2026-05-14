// ─────────────────────────────────────────────────────────────────────────────
//  Step 4 — Body parsing and schema validation.
//
//  Concepts:
//    • `await ctx.body.json()` lazily reads + parses the request body.
//    • Pass a validator (`{ parse(input): T }`, Zod, ArkType, or any
//      Standard-Schema-v1 validator) and the parser will narrow the type and
//      throw `RiftexValidationError` on bad input.
//    • The default error boundary serializes that error as a 422 with a
//      `fields` map — no custom handler required for the happy validation path.
//
//  Run:        npm run 4
//  Try it:     curl -X POST http://localhost:3000/users \
//                -H 'content-type: application/json' \
//                -d '{"name":"Ada","age":36}'
//              curl -X POST http://localhost:3000/users \
//                -H 'content-type: application/json' \
//                -d '{"name":"Ada"}'                              # 422
// ─────────────────────────────────────────────────────────────────────────────

import { riftex } from 'riftexpress'

interface NewUser {
  name: string
  age: number
}

const NewUserSchema = {
  parse(input: unknown): NewUser {
    if (typeof input !== 'object' || input === null) throw new Error('expected object')
    const obj = input as Record<string, unknown>
    if (typeof obj.name !== 'string') throw new Error('name: must be a string')
    if (typeof obj.age !== 'number') throw new Error('age: must be a number')
    return { name: obj.name, age: obj.age }
  },
}

const app = riftex()

app.post('/users', async (ctx) => {
  const user = await ctx.body.json(NewUserSchema)
  return { created: user }
})

const server = await app.listen(3000)
console.log(`Listening on http://localhost:${server.port}`)
