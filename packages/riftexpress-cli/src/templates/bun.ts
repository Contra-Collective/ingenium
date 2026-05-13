// Bun template: full example wired through riftexpress-bun's BunAdapter.

export const bunTemplate: Record<string, string> = {
  'package.json': `{
  "name": "\${NAME}",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts"
  },
  "dependencies": {
    "riftexpress": "^0.0.1",
    "riftexpress-bun": "^0.0.1"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.6.0"
  },
  "engines": {
    "bun": ">=1.1.0"
  }
}
`,

  'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["bun"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
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
bun.lockb
`,

  'src/index.ts': `import { riftex, Router, type RiftexMiddleware } from 'riftexpress'
import { BunAdapter } from 'riftexpress-bun'

const app = riftex()

const logger: RiftexMiddleware = async (ctx, next) => {
  const start = Date.now()
  await next()
  console.log(\`\${ctx.method} \${ctx.path} -> \${Date.now() - start}ms\`)
}
app.use(logger)
app.use(riftex.json())

app.get('/', () => 'Hello from \${NAME} (Bun)')
app.get('/users/:id', (ctx) => ({ id: ctx.params.id }))
app.post('/echo', async (ctx) => {
  const payload = await ctx.body.json<Record<string, unknown>>()
  return { youSent: payload }
})

const api = Router()
api.get('/health', () => ({ ok: true }))
api.get('/version', () => ({ version: '0.0.1' }))
app.use('/api', api)

app.onError((err, ctx) => {
  console.error('handler error:', err)
  ctx.json({ error: err instanceof Error ? err.message : 'unknown' }, 500)
})

const adapter = new BunAdapter(app)
const server = Bun.serve({
  port: 3000,
  fetch: (req) => adapter.fetch(req),
})

console.log(\`Listening on http://localhost:\${server.port}\`)
`,

  'README.md': `# \${NAME}

A RiftExpress project running on Bun via \`riftexpress-bun\`.

## Run

\`\`\`bash
bun install
bun run dev    # bun --watch
bun start      # one-shot
\`\`\`

Server starts on http://localhost:3000.
`,
}
