import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI_PATH = resolve(__dirname, '..', 'src', 'cli.ts')
const PKG_PATH = resolve(__dirname, '..', 'package.json')

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function runRex(args: string[], cwd?: string): RunResult {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', CLI_PATH, ...args],
    { cwd: cwd ?? process.cwd(), encoding: 'utf8' },
  )
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

let workDir: string

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ingenium-cli-test-'))
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('ingenium --version / -v', () => {
  it('prints package version', () => {
    const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as { version: string }
    const out = runRex(['--version'])
    expect(out.status).toBe(0)
    expect(out.stdout.trim()).toBe(pkg.version)

    const short = runRex(['-v'])
    expect(short.status).toBe(0)
    expect(short.stdout.trim()).toBe(pkg.version)
  })
})

describe('ingenium --help / -h', () => {
  it('prints usage', () => {
    const out = runRex(['--help'])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('Usage:')
    expect(out.stdout).toContain('ingenium new')
    expect(out.stdout).toContain('--bun')
    expect(out.stdout).toContain('--minimal')
  })

  it('-h prints usage too', () => {
    const out = runRex(['-h'])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('Usage:')
  })

  it('no args prints help', () => {
    const out = runRex([])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('Usage:')
  })
})

describe('ingenium routes', () => {
  it('reports the placeholder message', () => {
    const out = runRex(['routes'])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('not implemented in v0.0.1')
  })
})

describe('ingenium new <name> (default template)', () => {
  it('scaffolds a full project', () => {
    const out = runRex(['new', 'myapp'], workDir)
    expect(out.status).toBe(0)
    const root = join(workDir, 'myapp')
    expect(existsSync(join(root, 'package.json'))).toBe(true)
    expect(existsSync(join(root, 'tsconfig.json'))).toBe(true)
    expect(existsSync(join(root, '.gitignore'))).toBe(true)
    expect(existsSync(join(root, 'src', 'index.ts'))).toBe(true)
    expect(existsSync(join(root, 'README.md'))).toBe(true)

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      scripts: Record<string, string>
    }
    expect(pkg.name).toBe('myapp')
    expect(pkg.dependencies.ingenium).toBeDefined()
    expect(pkg.devDependencies.tsx).toBeDefined()
    expect(pkg.scripts.dev).toContain('tsx')
    expect(pkg.scripts.start).toContain('tsx')

    const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
    expect(index).toContain("from 'ingenium'")
    expect(index).toContain('app.onError')
    expect(index).toContain('Router()')
    expect(index).toContain('Hello from myapp')
  })
})

describe('ingenium new <name> --minimal', () => {
  it('scaffolds a minimal project', () => {
    const out = runRex(['new', 'minapp', '--minimal'], workDir)
    expect(out.status).toBe(0)
    const root = join(workDir, 'minapp')
    const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
    expect(index).toContain("from 'ingenium'")
    expect(index).toContain('Hello from minapp')
    expect(index).not.toContain('Router')
    expect(index).not.toContain('onError')
  })
})

describe('ingenium new <name> --bun', () => {
  it('scaffolds a bun project', () => {
    const out = runRex(['new', 'bunapp', '--bun'], workDir)
    expect(out.status).toBe(0)
    const root = join(workDir, 'bunapp')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
      engines: Record<string, string>
    }
    expect(pkg.dependencies['ingenium-bun']).toBeDefined()
    expect(pkg.scripts.start).toContain('bun')
    expect(pkg.engines.bun).toBeDefined()

    const index = readFileSync(join(root, 'src', 'index.ts'), 'utf8')
    expect(index).toContain("from 'ingenium-bun'")
    expect(index).toContain('BunAdapter')
    expect(index).toContain('Bun.serve')
  })
})

describe('ingenium new — overwrite protection', () => {
  it('refuses to overwrite an existing dir', () => {
    const target = join(workDir, 'existing')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'sentinel.txt'), 'keep me')

    const out = runRex(['new', 'existing'], workDir)
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain('already exists')
    expect(existsSync(join(target, 'sentinel.txt'))).toBe(true)
  })

  it('overwrites with --force', () => {
    const target = join(workDir, 'forceapp')
    mkdirSync(target, { recursive: true })

    const out = runRex(['new', 'forceapp', '--force'], workDir)
    expect(out.status).toBe(0)
    expect(existsSync(join(target, 'package.json'))).toBe(true)
  })
})

describe('ingenium <unknown>', () => {
  it('errors with a non-zero exit code', () => {
    const out = runRex(['frobnicate'])
    expect(out.status).not.toBe(0)
    expect(out.stderr).toContain('unknown command')
  })
})

describe('ingenium new — missing name', () => {
  it('errors and exits 2', () => {
    const out = runRex(['new'])
    expect(out.status).toBe(2)
    expect(out.stderr).toContain('missing project name')
  })
})
