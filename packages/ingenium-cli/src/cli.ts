// ingenium-cli entry. Zero runtime deps. Argv parsed by hand.
//
// Subcommands:
//   ingenium new <name> [--bun] [--minimal] [--force]
//   ingenium routes
//   ingenium --version | -v
//   ingenium --help    | -h

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { scaffold, type TemplateName } from './scaffold.ts'

const HELP = `ingenium — Ingenium project scaffolder

Usage:
  ingenium new <name> [--bun] [--minimal] [--force]
  ingenium routes
  ingenium --version
  ingenium --help

Commands:
  new <name>     Scaffold a new Ingenium project at ./<name>.
                 --minimal   bare hello-world template
                 --bun       Bun.serve adapter template
                 --force     overwrite an existing directory
  routes         (placeholder) print the route table for a project

Examples:
  ingenium new my-api
  ingenium new my-api --minimal
  ingenium new my-api --bun
`

interface ParsedArgs {
  command: string | undefined
  positionals: string[]
  flags: Set<string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags = new Set<string>()
  let command: string | undefined

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      flags.add(arg.slice(2))
    } else if (arg.startsWith('-') && arg.length > 1) {
      flags.add(arg.slice(1))
    } else if (command === undefined) {
      command = arg
    } else {
      positionals.push(arg)
    }
  }

  return { command, positionals, flags }
}

async function readVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkgPath = resolve(here, '..', 'package.json')
  const raw = await readFile(pkgPath, 'utf8')
  const pkg = JSON.parse(raw) as { version?: string }
  return pkg.version ?? '0.0.0'
}

function pickTemplate(flags: Set<string>): TemplateName {
  if (flags.has('bun')) return 'bun'
  if (flags.has('minimal')) return 'minimal'
  return 'default'
}

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2))

  if (flags.has('version') || flags.has('v')) {
    process.stdout.write(`${await readVersion()}\n`)
    return
  }

  if (command === undefined || flags.has('help') || flags.has('h')) {
    process.stdout.write(HELP)
    return
  }

  switch (command) {
    case 'new': {
      const name = positionals[0]
      if (name === undefined || name.length === 0) {
        process.stderr.write('ingenium new: missing project name\n\n')
        process.stderr.write(HELP)
        process.exit(2)
        return
      }
      const template = pickTemplate(flags)
      const force = flags.has('force')
      try {
        const target = resolve(process.cwd(), name)
        await scaffold(target, template, { force, projectName: name })
        process.stdout.write(`Created ${name} (${template} template)\n`)
        process.stdout.write(`\nNext steps:\n  cd ${name}\n  npm install\n  npm run dev\n`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`ingenium new: ${msg}\n`)
        process.exit(1)
      }
      return
    }
    case 'routes': {
      process.stdout.write(
        'ingenium routes: not implemented in v0.0.1; coming with route introspection API\n',
      )
      return
    }
    default: {
      process.stderr.write(`ingenium: unknown command "${command}"\n\n`)
      process.stderr.write(HELP)
      process.exit(2)
    }
  }
}

await main()
