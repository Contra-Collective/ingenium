// Minimal template: 10-line hello world.

export const minimalTemplate: Record<string, string> = {
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
*.log
.DS_Store
`,

  'src/index.ts': `import { ingenium } from 'ingenium'

const app = ingenium()
app.get('/', () => 'Hello from \${NAME}')

const server = await app.listen(3000)
console.log(\`Listening on http://localhost:\${server.port}\`)
`,

  'README.md': `# \${NAME}

Minimal Ingenium hello-world.

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
}
