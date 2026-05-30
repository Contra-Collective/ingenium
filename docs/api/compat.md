# `ingenium-compat`

Shim that lets Express-style `(req, res, next)` middleware run inside a Ingenium chain. Lives in [`packages/ingenium-compat`](../../packages/ingenium-compat).

## Install

```sh
npm install ingenium ingenium-compat
# plus whatever Express middleware you actually want:
npm install cors helmet cookie-parser
```

## API

```ts
import { expressCompat } from 'ingenium-compat'

function expressCompat(middleware: ExpressMiddleware): IngeniumMiddleware

type ExpressMiddleware = (req: any, res: any, next: (err?: unknown) => void) => void
```

`req` and `res` are typed as `any` on purpose — the shim objects do not implement the full `Request`/`Response` surface, and `any` lets cors/helmet/morgan/etc. accept them at the call site without `as never` gymnastics.

## Usage

```ts
import { ingenium } from 'ingenium'
import { expressCompat } from 'ingenium-compat'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'

const app = ingenium()
app.use(expressCompat(cors({ origin: 'https://app.example.com' })))
app.use(expressCompat(helmet()))
app.use(expressCompat(cookieParser()))
```

## Behavior

The shim wraps a `(req, res, next)` middleware so it can run inside a Ingenium middleware chain. The `req`/`res` passed to the middleware are **real Node streams** (`req` extends `stream.Readable`, `res` extends `stream.Writable`/`EventEmitter`) wired to the `IngeniumContext`:

- `req` streams the request body lazily — the underlying stream is only claimed when the middleware reads it, so body-reading middleware (`body-parser`, `multer`) work and header-only middleware pay nothing.
- `res` proxies header/status **live** to the context and buffers the body, flushing on `finish`. Response-transforming middleware that patch `res.write`/`res.end` (`compression`, `express-session`) work.
- Control flow:
  - If the middleware writes the response (`res.json/send/end`), the Ingenium chain is short-circuited.
  - If it calls `next()`, the downstream chain runs. When the middleware patched `res.write`/`res.end`, the downstream response is replayed through `res` so the patch takes effect; otherwise the downstream response is left untouched (fast path).
  - If it calls `next(err)` or throws, the wrapper rejects to the global `onError` boundary.
- Mirrors `req.*` mutations (`req.user`, `req.body`, `req.cookies`, …) back to `ctx.state` before the downstream chain reads them.

## Compatibility status

The matrix is validated end-to-end in [`packages/ingenium-compat/test/e2e.test.ts`](../../packages/ingenium-compat/test/e2e.test.ts). Headline notes:

- **Supported** — `cors`, `helmet`, `cookie-parser`, `morgan`, `express-rate-limit`, `compression`, `body-parser`, `express-session`, `multer`, `passport.initialize`.
- **Partial** — `passport.authenticate` (`res.redirect`/cookie writes work; session-backed strategies need a session store).

For the full per-middleware status and internals, see [`packages/ingenium-compat/COMPATIBILITY.md`](../../packages/ingenium-compat/COMPATIBILITY.md).

## When to use the shim vs a native equivalent

Reach for the shim when there's an established Express middleware whose feature set you'd rather not reimplement, or when migrating an existing app incrementally. Reach for the native API when starting fresh:

- You want lazy body parsing (`ctx.body.json()` instead of `body-parser`).
- You want a typed `ctx.session` with secret rotation (native `sessionMiddleware`).
- You want streaming/multipart with bounded memory (native `ctx.body.multipart()`).

Performance-wise the shim is opt-in and localized — the cost is paid only on requests that pass through a wrapped middleware, and the core fast paths are untouched. Header-only middleware stay close to free (live header proxy + lazy body); body-transforming middleware land at roughly Express cost. Native middleware avoids the shim entirely.
