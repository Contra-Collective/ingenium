# riftexpress-cli

`rex` — the project scaffolder for [RiftExpress](../riftexpress).

Zero runtime dependencies. No build step. Runs your TypeScript directly via Node 22+ native type stripping.

## Requirements

- **Node.js >= 22** (uses `--experimental-strip-types` to run `.ts` directly)

## Install

```bash
npm install -g riftexpress-cli
# or one-off
npx riftexpress-cli new my-api
```

## Usage

```text
rex new <name> [--bun] [--minimal] [--force]
rex routes
rex --version
rex --help
```

### `rex new <name>`

Scaffolds a new RiftExpress project at `./<name>`.

| Flag        | Effect                                                  |
| ----------- | ------------------------------------------------------- |
| _(none)_    | Full Express-like template (logger, JSON, sub-router).  |
| `--minimal` | Bare hello-world (~10 lines).                           |
| `--bun`     | Same as default but wired through `riftexpress-bun`.    |
| `--force`   | Overwrite if the target directory already exists.       |

Examples:

```bash
rex new my-api
rex new my-api --minimal
rex new my-api --bun
rex new my-api --force
```

The generated project includes:

- `package.json` (with `riftexpress` dependency, `tsx` for dev/start)
- `tsconfig.json` (strict)
- `src/index.ts` (template-specific entrypoint)
- `.gitignore`
- `README.md`

### `rex routes`

Placeholder. Will print the project's route table once the route introspection API lands.

### `rex --version` / `-v`

Prints the CLI version.

### `rex --help` / `-h`

Prints usage.

## How it works

The published `bin/rex.mjs` shim spawns `node --experimental-strip-types src/cli.ts` so there is no compile step in this package. The trade-off is that you need Node 22+; older Node versions will fail at startup.

## Development

```bash
npm run typecheck
npm test
```

Tests spawn the CLI as a real subprocess and assert the scaffolded files end up on disk.
