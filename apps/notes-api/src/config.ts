// Environment-driven configuration. All env reads funnel through here so the
// rest of the app can depend on a typed, validated `AppConfig` rather than
// scattered `process.env.X` accesses.

import { z } from 'zod'

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_FILE: z.string().min(1).default('./data/notes.db'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export type AppConfig = z.infer<typeof ConfigSchema>

/** Load and validate configuration from `process.env`. Throws if invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '_'}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid configuration:\n${issues}`)
  }
  return parsed.data
}
