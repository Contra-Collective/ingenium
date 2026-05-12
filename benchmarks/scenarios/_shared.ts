import autocannon from 'autocannon'

export interface BenchOptions {
  url: string
  connections?: number
  duration?: number
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: string
  headers?: Record<string, string>
  expectedStatusCode?: number
}

export interface BenchMetrics {
  requestsPerSec: number
  latencyP50Ms: number
  latencyP99Ms: number
  latencyAvgMs: number
  throughputBytesPerSec: number
  totalRequests: number
  errors: number
  non2xx: number
  timeouts: number
}

/**
 * Runs autocannon against a URL and returns parsed metrics.
 * Defaults: 100 connections, 10 second duration.
 */
export async function runBench(opts: BenchOptions): Promise<BenchMetrics> {
  const result = await autocannon({
    url: opts.url,
    connections: opts.connections ?? 100,
    duration: opts.duration ?? 10,
    method: opts.method ?? 'GET',
    body: opts.body,
    headers: opts.headers,
    // Don't print autocannon's own progress UI to keep output deterministic.
    // We print our own table after both runs complete.
  })

  return {
    requestsPerSec: result.requests.average,
    latencyP50Ms: result.latency.p50,
    latencyP99Ms: result.latency.p99,
    latencyAvgMs: result.latency.average,
    throughputBytesPerSec: result.throughput.average,
    totalRequests: result.requests.total,
    errors: result.errors,
    non2xx: result.non2xx,
    timeouts: result.timeouts,
  }
}

function fmtNum(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return 'n/a'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return 'n/a'
  if (n >= 1024 * 1024) return `${fmtNum(n / (1024 * 1024))} MiB/s`
  if (n >= 1024) return `${fmtNum(n / 1024)} KiB/s`
  return `${fmtNum(n, 0)} B/s`
}

function ratio(rift: number, express: number): string {
  if (express === 0 || !Number.isFinite(express) || !Number.isFinite(rift)) return 'n/a'
  const r = rift / express
  // Honest reporting: print exact ratio, no rounding-up.
  return `${r.toFixed(3)}x`
}

/**
 * Pretty-prints a side-by-side comparison table to stdout.
 * Honest numbers — no rounding-up, no spin.
 */
export function printComparison(
  label: string,
  expressResult: BenchMetrics,
  riftResult: BenchMetrics
): void {
  const rows: Array<[string, string, string, string]> = [
    ['Metric', 'Express', 'RiftExpress', 'Rift / Express'],
    [
      'Requests/sec (avg)',
      fmtNum(expressResult.requestsPerSec),
      fmtNum(riftResult.requestsPerSec),
      ratio(riftResult.requestsPerSec, expressResult.requestsPerSec),
    ],
    [
      'Latency p50 (ms)',
      fmtNum(expressResult.latencyP50Ms),
      fmtNum(riftResult.latencyP50Ms),
      ratio(riftResult.latencyP50Ms, expressResult.latencyP50Ms),
    ],
    [
      'Latency p99 (ms)',
      fmtNum(expressResult.latencyP99Ms),
      fmtNum(riftResult.latencyP99Ms),
      ratio(riftResult.latencyP99Ms, expressResult.latencyP99Ms),
    ],
    [
      'Latency avg (ms)',
      fmtNum(expressResult.latencyAvgMs),
      fmtNum(riftResult.latencyAvgMs),
      ratio(riftResult.latencyAvgMs, expressResult.latencyAvgMs),
    ],
    [
      'Throughput',
      fmtBytes(expressResult.throughputBytesPerSec),
      fmtBytes(riftResult.throughputBytesPerSec),
      ratio(riftResult.throughputBytesPerSec, expressResult.throughputBytesPerSec),
    ],
    [
      'Total requests',
      fmtNum(expressResult.totalRequests, 0),
      fmtNum(riftResult.totalRequests, 0),
      ratio(riftResult.totalRequests, expressResult.totalRequests),
    ],
    [
      'Errors',
      String(expressResult.errors),
      String(riftResult.errors),
      '-',
    ],
    [
      'Non-2xx',
      String(expressResult.non2xx),
      String(riftResult.non2xx),
      '-',
    ],
    [
      'Timeouts',
      String(expressResult.timeouts),
      String(riftResult.timeouts),
      '-',
    ],
  ]

  const widths = [0, 1, 2, 3].map((c) =>
    rows.reduce((max, row) => Math.max(max, row[c].length), 0)
  )

  const sep =
    '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+'

  const renderRow = (row: [string, string, string, string]) =>
    '| ' +
    row.map((cell, i) => cell.padEnd(widths[i])).join(' | ') +
    ' |'

  console.log('')
  console.log(`=== ${label} ===`)
  console.log(sep)
  console.log(renderRow(rows[0]))
  console.log(sep)
  for (let i = 1; i < rows.length; i++) {
    console.log(renderRow(rows[i]))
  }
  console.log(sep)
  console.log('')
  console.log('Note: regression detector only — see benchmarks/README.md.')
  console.log('')
}

/**
 * Standardized header banner for a scenario.
 */
export function printHeader(scenario: string, config: { connections: number; duration: number }) {
  console.log('')
  console.log(`### Scenario: ${scenario}`)
  console.log(`### autocannon: -c ${config.connections} -d ${config.duration}`)
  console.log(`### Node ${process.version} on ${process.platform} ${process.arch}`)
}
