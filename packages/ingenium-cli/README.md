# ingenium-cli

`ingenium` — the project scaffolder for [Ingenium](../ingenium).

Zero runtime dependencies. No build step. Runs your TypeScript directly via Node 22+ native type stripping.

## Requirements

- **Node.js >= 22** (uses `--experimental-strip-types` to run `.ts` directly)

## Install

```bash
npm install -g ingenium-cli
# or one-off
npx ingenium-cli new my-api
```

## Usage

```text
ingenium new <name> [--bun] [--minimal] [--force]
ingenium routes
ingenium --version
ingenium --help
```

### `ingenium new <name>`

Scaffolds a new Ingenium project at `./<name>`.

| Flag        | Effect                                                  |
| ----------- | ------------------------------------------------------- |
| _(none)_    | Full Express-like template (logger, JSON, sub-router).  |
| `--minimal` | Bare hello-world (~10 lines).                           |
| `--bun`     | Same as default but wired through `ingenium-bun`.    |
| `--force`   | Overwrite if the target directory already exists.       |

Examples:

```bash
ingenium new my-api
ingenium new my-api --minimal
ingenium new my-api --bun
ingenium new my-api --force
```

The generated project includes:

- `package.json` (with `ingenium` dependency, `tsx` for dev/start)
- `tsconfig.json` (strict)
- `src/index.ts` (template-specific entrypoint)
- `.gitignore`
- `README.md`

### `ingenium routes`

Placeholder. Will print the project's route table once the route introspection API lands.

### `ingenium --version` / `-v`

Prints the CLI version.

### `ingenium --help` / `-h`

Prints usage.

## How it works

The published `bin/ingenium.mjs` shim spawns `node --experimental-strip-types src/cli.ts` so there is no compile step in this package. The trade-off is that you need Node 22+; older Node versions will fail at startup.

## Development

```bash
npm run typecheck
npm test
```

Tests spawn the CLI as a real subprocess and assert the scaffolded files end up on disk.
