# `ingenium-cli`

Project scaffolder. Zero runtime dependencies — only Node built-ins. Lives in [`packages/ingenium-cli`](../../packages/ingenium-cli).

## Install

```sh
npm install -g ingenium-cli
```

Or run on demand without installing:

```sh
npx ingenium-cli new my-api
```

**Requires Node 22+** — the CLI runs `.ts` sources via `--experimental-strip-types`.

## Usage

```sh
ingenium new <name> [--bun] [--minimal] [--force]
ingenium routes
ingenium --version
ingenium --help
```

### `ingenium new <name>`

Scaffold a new Ingenium project at `./<name>`.

| Flag | Effect |
|---|---|
| `--minimal` | Bare hello-world template (10-line `src/index.ts`). |
| `--bun` | Bun.serve adapter template (`ingenium-bun`). |
| `--force` | Overwrite an existing directory at the target path. |

Without `--bun` or `--minimal`, the default template is used.

Templates available (in `packages/ingenium-cli/src/templates/`):

- `default` — full skeleton: `package.json`, `tsconfig.json`, `.gitignore`, `src/index.ts`, `README.md`.
- `minimal` — same skeleton with a tiny hello-world `src/index.ts`.
- `bun` — Bun.serve variant wired through `BunAdapter`.

Argv is parsed by hand — `--key` and `-k` are both flag-only (no values consumed), and the first non-flag argument is the command, with the rest accumulated as positionals.

### `ingenium routes`

Placeholder in v0.0.1 — prints a "not implemented" notice. Will print the registered route table once the route-introspection API ships.

### `ingenium --version` / `ingenium -v`

Prints the CLI version (read from its own `package.json`).

### `ingenium --help` / `ingenium -h`

Prints the help banner.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Scaffold failed (filesystem error, target exists without `--force`, etc.). |
| `2` | Argv error — unknown command, missing project name. |

## Examples

```sh
ingenium new my-api                      # default template
ingenium new my-bun-api --bun            # Bun.serve adapter
ingenium new tiny --minimal              # minimal hello-world
ingenium new my-api --force              # overwrite existing dir
```

After scaffolding, the CLI prints `Next steps:` with the conventional three-line `cd / npm install / npm run dev` instructions.
