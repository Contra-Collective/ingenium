import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // In dev, resolve workspace bare specifiers to source so we don't need a build step.
      'riftexpress-compat': here('./packages/riftexpress-compat/src/index.ts'),
      'riftexpress-bun': here('./packages/riftexpress-bun/src/index.ts'),
      'riftexpress-cli': here('./packages/riftexpress-cli/src/cli.ts'),
      riftexpress: here('./packages/riftexpress/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 10_000,
  },
})
