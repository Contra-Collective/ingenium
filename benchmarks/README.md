# Ingenium Benchmarks

Local regression benchmarks comparing Ingenium against Express on identical
workloads. Each scenario boots both frameworks on ephemeral `127.0.0.1` ports,
runs `autocannon` against each, and prints a side-by-side comparison.

## Mandatory disclaimer

> These benchmarks are run on a developer machine and are NOT publishable
> performance claims. Production-grade comparison numbers require dedicated
> isolated hardware (no other processes), thermal-stable environment, multiple
> runs with std-dev reported, and Express/Fastify/Hono baselines maintained at
> their latest released versions. Treat these scenarios as regression detectors
> during development, not marketing material.

## Scenarios

| Script              | Command                  | What it measures                                    |
| ------------------- | ------------------------ | --------------------------------------------------- |
| `hello.ts`          | `npm run bench:hello`    | Bare `GET /` JSON response — router + serializer.   |
| `body-json.ts`      | `npm run bench:body`     | `POST /echo` with JSON parsing + echo timestamp.    |
| `middleware-stack.ts` | `npm run bench:middleware` | 10-layer middleware chain overhead per request.    |
| `error-path.ts`     | `npm run bench:errors`   | Cost of routing through the framework error boundary. |

Run all sequentially:

```sh
npm run bench:all
```

## autocannon configuration

All scenarios use:

- `-c 100` (100 concurrent connections)
- `-d 10` (10 second duration)
- Bind: `127.0.0.1` on an OS-assigned ephemeral port (`port: 0`)

Reported metrics per scenario:

- `Requests/sec (avg)`
- `Latency p50` / `p99` / `avg` (ms)
- `Throughput` (bytes/sec)
- `Total requests`, `Errors`, `Non-2xx`, `Timeouts`
- `Rift / Express` ratio column — exact, no rounding-up

## Methodology

### Hardware spec template (fill in before sharing any numbers)

```
CPU:           <model, base GHz, core count>
Memory:        <GB, type, speed>
OS:            <name + version>
Node version:  <e.g. 20.18.0>
Ingenium:   <commit SHA from packages/ingenium>
Express:       <version pinned in benchmarks/package.json>
Background load: <what else was running on the machine>
Power profile: <e.g. plugged in, performance mode, no throttling>
```

### How to interpret results

- **Single-run numbers are noisy.** Run each scenario at least 3-5 times and
  look at trends, not point values. autocannon's own averages already smooth
  within a run, but run-to-run variance on a developer machine is real.
- **Latency p99 matters more than requests/sec** for tail-sensitive workloads.
  A higher mean throughput with a worse p99 is often a regression in disguise.
- **Throughput differences in the `body-json` scenario** primarily reflect
  body-parser overhead, not raw routing — interpret accordingly.
- **The `error-path` scenario produces non-2xx responses on purpose.** Both
  frameworks return `500` from their error boundary; autocannon's `Non-2xx`
  counter is expected to roughly equal `Total requests`.
- **A `Rift / Express` ratio of `1.000x` means parity.** Above 1.0 means Rift
  did more (or had higher latency, depending on the metric). Read the metric
  name carefully — for latency, lower is better; for throughput, higher is
  better.

### What this suite is for

- Catching regressions in the Ingenium core during development.
- Sanity-checking that a change didn't accidentally make the hot path slower.
- Comparing two Ingenium commits against each other (run the suite on
  baseline, then on the change branch, diff the tables).

### What this suite is NOT for

- Marketing claims.
- Cross-framework leaderboards.
- Decisions about adopting Ingenium in production.

For any of those, use a dedicated benchmark harness on isolated hardware with
multiple frameworks at their latest pinned versions, multiple runs, std-dev
reporting, and warmup phases that this suite does not perform.

## Files

```
benchmarks/
  package.json
  README.md
  scenarios/
    _shared.ts            # autocannon runner + comparison printer
    hello.ts
    body-json.ts
    middleware-stack.ts
    error-path.ts
```
