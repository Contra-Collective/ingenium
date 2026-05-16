// Default template: full Express-like example.

export const defaultTemplate: Record<string, string> = {
  'package.json': `{
  "name": "\${NAME}",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "ingenium": "^0.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
`,

  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
`,

  '.gitignore': `node_modules
dist
.env
.env.local
*.log
.DS_Store
`,

  'src/index.ts': `import { ingenium, Router, type IngeniumMiddleware } from 'ingenium'

const app = ingenium()

// Logger middleware — same (ctx, next) pattern Koa users will recognize.
const logger: IngeniumMiddleware = async (ctx, next) => {
  const start = Date.now()
  await next()
  console.log(\`\${ctx.method} \${ctx.path} -> \${Date.now() - start}ms\`)
}
app.use(logger)

// JSON body parsing default (no-op in v0.0.1; kept for Express ergonomics).
app.use(ingenium.json())

// GET / — return any value, Ingenium reflects it to the wire.
app.get('/', () => 'Hello from \${NAME}')

// GET /users/:id — typed params from the path string.
app.get('/users/:id', (ctx) => ({ id: ctx.params.id }))

// POST /echo — body is lazily parsed via ctx.body.json().
app.post('/echo', async (ctx) => {
  const payload = await ctx.body.json<Record<string, unknown>>()
  return { youSent: payload }
})

// Sub-router mounted at /api.
const api = Router()
api.get('/health', () => ({ ok: true }))
api.get('/version', () => ({ version: '0.0.1' }))
app.use('/api', api)

// Centralized error handler.
app.onError((err, ctx) => {
  console.error('handler error:', err)
  ctx.json({ error: err instanceof Error ? err.message : 'unknown' }, 500)
})

const server = await app.listen(3000)
console.log(\`Listening on http://localhost:\${server.port}\`)
`,

  'README.md': `# \${NAME}

A Ingenium project scaffolded with \`ingenium new\`.

## Run

\`\`\`bash
npm install
npm run dev   # tsx watch
npm start     # one-shot
\`\`\`

Server starts on http://localhost:3000.

## Routes

- \`GET  /\`              — hello
- \`GET  /users/:id\`      — echoes the param
- \`POST /echo\`           — echoes the JSON body
- \`GET  /api/health\`     — \`{ ok: true }\`
- \`GET  /api/version\`    — \`{ version: '0.0.1' }\`
`,
}
