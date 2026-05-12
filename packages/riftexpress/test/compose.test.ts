import { describe, it, expect } from 'vitest'
import { compose, composeWithHandler } from '../src/middleware/compose.ts'
import type { RexMiddleware } from '../src/middleware/types.ts'
import { RexContext } from '../src/context/context.ts'

const makeCtx = (): RexContext => new RexContext()

describe('compose()', () => {
  it('empty stack returns immediately (resolves)', async () => {
    const handler = compose([])
    await expect(handler(makeCtx())).resolves.toBeUndefined()
  })

  it('runs middleware left-to-right and unwinds right-to-left', async () => {
    const order: string[] = []
    const a: RexMiddleware = async (_ctx, next) => {
      order.push('a:in')
      await next()
      order.push('a:out')
    }
    const b: RexMiddleware = async (_ctx, next) => {
      order.push('b:in')
      await next()
      order.push('b:out')
    }
    const c: RexMiddleware = async () => {
      order.push('c')
    }
    await compose([a, b, c])(makeCtx())
    expect(order).toEqual(['a:in', 'b:in', 'c', 'b:out', 'a:out'])
  })

  it('thrown error in middleware propagates to caller', async () => {
    const boom: RexMiddleware = async () => {
      throw new Error('boom')
    }
    const wrapper: RexMiddleware = async (_ctx, next) => {
      await next()
    }
    await expect(compose([wrapper, boom])(makeCtx())).rejects.toThrow('boom')
  })

  it('error from a downstream middleware can be caught upstream', async () => {
    let caught: unknown = null
    const upstream: RexMiddleware = async (_ctx, next) => {
      try {
        await next()
      } catch (err) {
        caught = err
      }
    }
    const boom: RexMiddleware = async () => {
      throw new Error('downstream')
    }
    await compose([upstream, boom])(makeCtx())
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('downstream')
  })

  it('short-circuits when middleware does not call next()', async () => {
    const order: string[] = []
    const guard: RexMiddleware = async () => {
      order.push('guard')
      // intentionally no next()
    }
    const tail: RexMiddleware = async () => {
      order.push('tail')
    }
    await compose([guard, tail])(makeCtx())
    expect(order).toEqual(['guard'])
  })

  it('await chain resolves sequentially across async boundaries', async () => {
    const order: string[] = []
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const a: RexMiddleware = async (_ctx, next) => {
      await wait(5)
      order.push('a')
      await next()
    }
    const b: RexMiddleware = async (_ctx, next) => {
      await wait(1)
      order.push('b')
      await next()
    }
    const c: RexMiddleware = async () => {
      order.push('c')
    }
    await compose([a, b, c])(makeCtx())
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('composeWithHandler appends terminal handler', async () => {
    const order: string[] = []
    const mw: RexMiddleware = async (_ctx, next) => {
      order.push('mw:in')
      await next()
      order.push('mw:out')
    }
    const composed = composeWithHandler([mw], async () => {
      order.push('handler')
    })
    await composed(makeCtx())
    expect(order).toEqual(['mw:in', 'handler', 'mw:out'])
  })
})
