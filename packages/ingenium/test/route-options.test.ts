import { describe, it, expect } from 'vitest'
import { ingenium } from '../src/index.ts'
import { IngeniumApp } from '../src/app.ts'
import { IngeniumContext } from '../src/context/context.ts'
import { generateOpenApi } from '../src/openapi/generate.ts'
import { descriptorKey, type RouteDescriptor } from '../src/openapi/describe.ts'
import type { IngeniumMiddleware } from '../src/middleware/types.ts'
import type { StandardSchemaV1 } from '../src/schema/standard.ts'

/**
 * Well-known route-options keys (`tags`, `summary`, `description`,
 * `deprecated`, `operationId`, `security`, `parameters`, `response`,
 * `requestBody`) get peeled off at REGISTRATION time and routed through
 * `app.describe(method, path, ...)`. The remaining keys go through the
 * declarator pipeline. The two halves coexist in the same options object
 * without either tripping the other.
 */

function makeCtx(method = 'GET', path = '/'): IngeniumContext {
  const ctx = new IngeniumContext()
  ctx.method = method as IngeniumContext['method']
  ctx.path = path
  ctx.url = path
  return ctx
}

function readDescriptor(app: IngeniumApp, method: string, path: string): RouteDescriptor | undefined {
  const map = (app as unknown as { _routeDescriptors: Map<string, RouteDescriptor> })._routeDescriptors
  return map.get(descriptorKey(method as never, path))
}

const noop = () => undefined

describe('built-in route option keys → describe()', () => {
  it('{ tags } populates the descriptor tags', () => {
    const app = ingenium()
    app.get('/users', { tags: ['users'] }, noop)
    expect(readDescriptor(app, 'GET', '/users')!.tags).toEqual(['users'])
  })

  it('{ summary, description } populates those fields', () => {
    const app = ingenium()
    app.get('/users/:id', { summary: 'Get a user', description: 'Returns the user...' }, noop)
    const d = readDescriptor(app, 'GET', '/users/:id')!
    expect(d.summary).toBe('Get a user')
    expect(d.description).toBe('Returns the user...')
  })

  it('{ deprecated: true } populates deprecated', () => {
    const app = ingenium()
    app.get('/old', { deprecated: true }, noop)
    expect(readDescriptor(app, 'GET', '/old')!.deprecated).toBe(true)
  })

  it('{ operationId } populates operationId', () => {
    const app = ingenium()
    app.get('/users/:id', { operationId: 'getUser' }, noop)
    expect(readDescriptor(app, 'GET', '/users/:id')!.operationId).toBe('getUser')
  })

  it('{ security } populates security', () => {
    const app = ingenium()
    app.get('/me', { security: [{ bearer: [] }] }, noop)
    expect(readDescriptor(app, 'GET', '/me')!.security).toEqual([{ bearer: [] }])
  })

  it('{ parameters } populates parameters verbatim', () => {
    const app = ingenium()
    app.get('/search', {
      parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
    }, noop)
    expect(readDescriptor(app, 'GET', '/search')!.parameters).toEqual([
      { name: 'q', in: 'query', schema: { type: 'string' } },
    ])
  })

  it('{ response: SchemaObject } populates the 200 response body', () => {
    const app = ingenium()
    const UserSchema = { type: 'object', properties: { id: { type: 'string' } } }
    app.get('/users/:id', { response: UserSchema }, noop)
    const r = readDescriptor(app, 'GET', '/users/:id')!.responses!
    expect(r['200']!.description).toBe('OK')
    expect(r['200']!.content!['application/json']!.schema).toEqual(UserSchema)
  })

  it('{ response: { "404": ... } } populates a status-keyed response map', () => {
    const app = ingenium()
    app.get('/users/:id', {
      response: {
        '200': { type: 'object', properties: { id: { type: 'string' } } },
        '404': { description: 'Not found' },
      },
    }, noop)
    const r = readDescriptor(app, 'GET', '/users/:id')!.responses!
    expect(r['200']!.content!['application/json']!.schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    })
    expect(r['404']!.description).toBe('Not found')
  })

  it('{ requestBody: SchemaObject } populates requestBody on POST', () => {
    const app = ingenium()
    const NewUser = { type: 'object', properties: { name: { type: 'string' } } }
    app.post('/users', { requestBody: NewUser }, noop)
    const rb = readDescriptor(app, 'POST', '/users')!.requestBody!
    expect(rb.content['application/json']!.schema).toEqual(NewUser)
  })

  it('{ requestBody: { content } } passes through an already-shaped RequestBody', () => {
    const app = ingenium()
    app.post('/users', {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    }, noop)
    const rb = readDescriptor(app, 'POST', '/users')!.requestBody!
    expect(rb.required).toBe(true)
    expect(rb.content['application/json']!.schema).toEqual({ type: 'object' })
  })
})

describe('built-in keys + user declarators in the same options object', () => {
  it('built-in keys go to describe, declarator keys run through the declarator pipeline', async () => {
    const app = ingenium()
    const order: string[] = []
    app.declare<string[]>('auth', (roles) => async (ctx, next) => {
      order.push(`auth:${roles.join(',')}`)
      ctx.state.roles = roles
      await next()
    })
    app.get('/admin', { tags: ['admin'], auth: ['admin'] }, (ctx) => {
      order.push('handler')
      ctx.text('ok')
    })

    // Built-in key reached the descriptor.
    expect(readDescriptor(app, 'GET', '/admin')!.tags).toEqual(['admin'])

    // Declarator middleware still ran.
    await app.handle(makeCtx('GET', '/admin'))
    expect(order).toEqual(['auth:admin', 'handler'])
  })

  it('built-in keys do NOT trigger "unknown declarator" when no declarators are registered', () => {
    const app = ingenium()
    expect(() => {
      app.get('/users', { tags: ['users'], summary: 'List' }, noop)
    }).not.toThrow()
  })
})

describe('inline-schema rejection (Standard Schema / Zod validators)', () => {
  it('{ response: standardSchema } throws TypeError at REGISTRATION time', () => {
    const app = ingenium()
    const std: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'pretendvalibot',
        validate: () => ({ value: {} }),
      },
    }
    expect(() => {
      app.get('/users/:id', { response: std as never }, noop)
    }).toThrow(/inline schema conversion isn't supported yet/)
  })

  it('{ requestBody: standardSchema } throws TypeError at REGISTRATION time', () => {
    const app = ingenium()
    const std: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'pretendvalibot',
        validate: () => ({ value: {} }),
      },
    }
    expect(() => {
      app.post('/users', { requestBody: std as never }, noop)
    }).toThrow(/inline schema conversion isn't supported yet/)
  })

  it('{ response: zodLike } (has safeParse) throws TypeError at REGISTRATION time', () => {
    const app = ingenium()
    const zod = { safeParse: () => ({ success: true, data: {} }) }
    expect(() => {
      app.get('/users/:id', { response: zod as never }, noop)
    }).toThrow(/inline schema conversion isn't supported yet/)
  })

  it('{ requestBody: zodLike } (has safeParse) throws TypeError at REGISTRATION time', () => {
    const app = ingenium()
    const zod = { safeParse: () => ({ success: true, data: {} }) }
    expect(() => {
      app.post('/users', { requestBody: zod as never }, noop)
    }).toThrow(/inline schema conversion isn't supported yet/)
  })

  it('error type is TypeError', () => {
    const app = ingenium()
    const std: StandardSchemaV1 = {
      '~standard': { version: 1, vendor: 'v', validate: () => ({ value: {} }) },
    }
    let caught: unknown
    try {
      app.get('/x', { response: std as never }, noop)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(TypeError)
  })
})

describe('describe() merge semantics', () => {
  it('inline { summary } + later explicit describe({ tags }) → both survive', () => {
    const app = ingenium()
    app.get('/users/:id', { summary: 'Get user' }, noop)
    app.describe('GET', '/users/:id', { tags: ['users'] })
    const d = readDescriptor(app, 'GET', '/users/:id')!
    expect(d.summary).toBe('Get user')
    expect(d.tags).toEqual(['users'])
  })

  it('explicit describe before inline → both survive', () => {
    const app = ingenium()
    app.describe('GET', '/users/:id', { tags: ['users'] })
    app.get('/users/:id', { summary: 'Get user' }, noop)
    const d = readDescriptor(app, 'GET', '/users/:id')!
    expect(d.summary).toBe('Get user')
    expect(d.tags).toEqual(['users'])
  })

  it('later key wins on conflict (shallow merge)', () => {
    const app = ingenium()
    app.get('/users/:id', { summary: 'First' }, noop)
    app.describe('GET', '/users/:id', { summary: 'Second' })
    expect(readDescriptor(app, 'GET', '/users/:id')!.summary).toBe('Second')
  })

  it('multiple inline registrations on the same route are not the intended pattern — last describe call wins on conflict', () => {
    const app = ingenium()
    app.get('/users/:id', { tags: ['a'] }, noop)
    // A second app.get re-registers the route entry (Router journal),
    // but the describe call here merges, last write wins on conflict.
    app.describe('GET', '/users/:id', { tags: ['b'] })
    expect(readDescriptor(app, 'GET', '/users/:id')!.tags).toEqual(['b'])
  })
})

describe('generateOpenApi() round-trip with inline options', () => {
  it('inline { tags, summary, response } shows up in the generated spec', () => {
    const app = ingenium()
    const UserSchema = { type: 'object', properties: { id: { type: 'string' } } }
    app.get('/users/:id', {
      tags: ['users'],
      summary: 'Get a user by ID',
      response: UserSchema,
    }, noop)
    const spec = generateOpenApi(app, { info: { title: 'X', version: '1.0' } })
    const op = spec.paths['/users/{id}']!.get!
    expect(op.tags).toEqual(['users'])
    expect(op.summary).toBe('Get a user by ID')
    expect(op.responses!['200']!.description).toBe('OK')
    expect(op.responses!['200']!.content!['application/json']!.schema).toEqual(UserSchema)
  })

  it('inline { requestBody } on POST shows up in the spec', () => {
    const app = ingenium()
    const Body = { type: 'object', properties: { name: { type: 'string' } } }
    app.post('/users', { requestBody: Body, tags: ['users'] }, noop)
    const spec = generateOpenApi(app, { info: { title: 'X', version: '1.0' } })
    const op = spec.paths['/users']!.post!
    expect(op.requestBody!.content['application/json']!.schema).toEqual(Body)
    expect(op.tags).toEqual(['users'])
  })

  it('inline { deprecated: true } shows up in the spec', () => {
    const app = ingenium()
    app.get('/old', { deprecated: true }, noop)
    const spec = generateOpenApi(app, { info: { title: 'X', version: '1.0' } })
    expect(spec.paths['/old']!.get!.deprecated).toBe(true)
  })

  it('inline { parameters } are appended after path-extracted parameters', () => {
    const app = ingenium()
    app.get('/users/:id', {
      parameters: [{ name: 'expand', in: 'query', schema: { type: 'string' } }],
    }, noop)
    const spec = generateOpenApi(app, { info: { title: 'X', version: '1.0' } })
    const op = spec.paths['/users/{id}']!.get!
    expect(op.parameters!.map((p) => `${p.in}:${p.name}`)).toEqual(['path:id', 'query:expand'])
  })

  it('mixed inline (built-in + declarator) still produces correct spec AND working middleware', async () => {
    const app = ingenium()
    const order: string[] = []
    const mw: IngeniumMiddleware = async (_c, next) => {
      order.push('auth')
      await next()
    }
    app.declare('auth', () => mw)
    app.get('/admin', { tags: ['admin'], auth: true }, (ctx) => {
      order.push('handler')
      ctx.text('ok')
    })

    // Spec sees the tags.
    const spec = generateOpenApi(app, { info: { title: 'X', version: '1.0' } })
    expect(spec.paths['/admin']!.get!.tags).toEqual(['admin'])

    // Middleware actually runs.
    await app.handle(makeCtx('GET', '/admin'))
    expect(order).toEqual(['auth', 'handler'])
  })
})
