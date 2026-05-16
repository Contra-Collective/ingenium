# Contributing to Ingenium

Thanks for your interest in contributing. This guide covers everything you
need to know to land a change in the repository.

## Code of Conduct

This project follows the [Contributor Covenant v2.1][covenant]. By
participating you agree to abide by its terms. Report unacceptable behavior
to the maintainers — see [SECURITY.md](./SECURITY.md) for the contact
channel.

[covenant]: https://www.contributor-covenant.org/version/2/1/code_of_conduct/

## Getting set up

```sh
git clone https://github.com/ingenium/ingenium.git
cd ingenium
npm install
npm test
npm run typecheck
```

Requirements:

- **Node.js >= 20.** CI runs against 20, 22, and 24.
- **Bun >= 1.1** is optional — only required if you're touching
  `packages/ingenium-bun`.
- npm 10+ (ships with Node 20.5+).

## Repo structure

This is a workspaces monorepo:

| Path                          | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `packages/ingenium`        | Core framework — `ingenium()`, `Router`, `IngeniumContext`, plugins   |
| `packages/ingenium-compat` | `expressCompat(mw)` shim for `(req, res, next)` middleware  |
| `packages/ingenium-bun`    | `BunAdapter` transport for `Bun.serve()`                    |
| `packages/ingenium-cli`    | `ingenium new` project scaffolder                                |
| `examples/*`                  | Runnable examples — `basic`, `migrate-from-express`, etc.   |
| `apps/*`                      | Internal apps used during development                       |
| `benchmarks/`                 | Comparative throughput harness vs Express, Hono, Fastify    |
| `docs/`                       | Long-form docs — migration guide, plugins, ADRs, roadmap    |
| `docs/adr/`                   | Architecture decision records (`0001`–`0005`)               |
| `docs/api/`                   | Per-export API reference                                    |
| `API.md`                      | Locked public surface for the current version               |

The ADRs in `docs/adr/` are the load-bearing design choices and the
rationale behind them. Read them before proposing significant changes.

## Commit message convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
The shapes we expect:

```
feat(router): add typed param extraction for *wild
fix(static): handle ENOENT when extensions resolve a directory
docs(plugins): clarify decorate vs decorateRequest cost
chore(deps): bump vitest to 2.1.4
```

Types we use: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`. Use the package or area name as the optional
scope (e.g. `feat(bun): ...`, `fix(compat): ...`).

Breaking changes get a `!` after the type/scope and a `BREAKING CHANGE:`
footer:

```
feat(app)!: drop Node 18 support

BREAKING CHANGE: minimum Node version raised to 20.
```

## Branch naming

- `feature/<short-name>` — new functionality
- `fix/<short-name>` — bug fixes
- `docs/<short-name>` — documentation-only changes
- `chore/<short-name>` — dependency bumps, repo hygiene

Branch from `main`. Rebase before opening the PR — we keep history linear.

## PR process

1. Open the PR against `main` using the provided template
   ([`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)).
2. CI must be green: typecheck + tests on Node 20 / 22 / 24, Linux + Windows.
3. New runtime code requires test coverage. New public API requires an entry
   in `API.md`, a doc update under `docs/api/`, and a `CHANGELOG.md`
   entry under `## [Unreleased]`.
4. Performance-sensitive changes should include a `benchmarks/` run before
   and after — eyeballed regressions are easier to catch than measured ones.
5. Reviewers may request that the change be split into smaller commits.

## Release process

Releases are driven by GitHub Actions:

- **Alpha / beta publishes** — manually triggered via
  [`.github/workflows/publish.yml`][publish]. The workflow refuses to
  publish a version that is not tagged `-alpha` or `-beta`. Production
  releases (no prerelease suffix) require a separate `release-prod.yml`
  workflow that does not yet exist — see the TODO in `publish.yml`.
- **GitHub Releases** — automatically created when a `v*` tag is pushed
  via [`.github/workflows/release.yml`][release]. The release body is
  pulled from the matching `CHANGELOG.md` section.

[publish]: ./.github/workflows/publish.yml
[release]: ./.github/workflows/release.yml

## Security policy

Vulnerabilities should NOT be reported via public issues. See
[SECURITY.md](./SECURITY.md) for the disclosure channel and response
timeline.

## Questions

Open a Discussion (preferred) or a low-priority Issue tagged `question`.
PRs that add features without prior discussion are unlikely to land —
read `docs/roadmap.md` first.
