# Bench v2 methodology

This directory replaces v1's same-process, single-shot, two-framework comparison
with a methodology that is at least defensible as a *local regression detector*.

## What v2 does differently

1. **Separate child processes per framework.** Each framework's server runs in
   its own `node --experimental-strip-types` child process spawned by the
   runner. v1 booted Express and RiftExpress in the same Node process, which
   meant their V8 hidden classes, JIT caches, GC pressure, and module-init
   timing were entangled. The second framework was effectively benchmarking
   the steady-state of the first.
2. **5 samples per framework, plus one warmup.** v1 took a single 10s shot.
   v2 takes one warmup run (discarded) then 5 independent runs and reports
   mean, std-dev, median, and p99 across them. A run with a std-dev wider than
   ~5% of the mean should not be quoted as a comparison.
3. **Std-dev reported.** A delta smaller than 1 std-dev across runs is noise.
   The table makes that visible.
4. **Four frameworks compared.** Express, Fastify, Hono, and RiftExpress.
   Comparing only against Express makes any "win" trivial; including Fastify
   and Hono prevents that.
5. **Frameworks pinned at the versions in `benchmarks/package.json`.** v1
   would silently drift if Express minor-bumped. v2 still does technically
   (semver `^`), but the pinning intent is documented and a frozen lockfile
   should be committed if you publish numbers.

## What v2 still does NOT do

These are the reasons numbers from v2 are still **not** publishable:

- No CPU pinning (`taskset` / Windows affinity).
- No isolated hardware — laptop runs include browser tabs, Slack, Spotlight, etc.
- The autocannon driver, the framework, and the OS scheduler all share cores.
- No P-state / turbo boost lockdown.
- Single sample size (`-c 100 -d 5`) — production-grade benchmarks sweep
  connection counts and durations.
- No baseline phase that re-measures the same framework periodically across the
  run to detect drift.
- No statistical significance testing (no t-test, no confidence intervals).

## The mandatory disclaimer

> These are local-developer-machine numbers. They are NOT publishable
> performance claims. Treat as regression detectors. For comparable production
> numbers, use isolated hardware with CPU pinning, multiple sample sizes,
> baseline + warmup phases, and pinned framework versions, all under
> continuous monitoring across runs.

This paragraph is also printed to stdout at the start and end of every v2 run
so anyone reading a CI log sees it before reading the numbers.

## Running

```
# All scenarios:
npm run bench:v2

# One scenario:
npm run bench:hello-v2
npm run bench:body-v2
npm run bench:middleware-v2
```

## Server contract

Each `_servers/*.ts` file:

1. Boots its framework on `127.0.0.1:0` (ephemeral port).
2. Prints exactly `READY:<port>\n` to stdout once listening.
3. Registers `process.on('SIGTERM', () => process.exit(0))` for graceful exit.

The runner reads stdout line-by-line until it sees the `READY:` line, then
runs autocannon against `http://127.0.0.1:<port>`. After the last sample it
sends `SIGTERM` and waits for the child to exit (with a 3s `SIGKILL` fallback).
