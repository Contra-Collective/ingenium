/**
 * `safeJsonStringify(value, opts?)` — a lenient `JSON.stringify` that never
 * throws on circular references or `BigInt` values.
 *
 * Behavior:
 * - Circular references → replaced with the string `'[Circular]'`.
 * - `BigInt` values     → serialized as a JSON string (e.g. `1n` → `"1"`).
 *   This preserves precision and is reversible by the caller; if you need a
 *   different convention, pass your own `replacer`.
 * - Symbol values       → omitted (matches `JSON.stringify` default).
 * - Functions           → omitted (matches `JSON.stringify` default).
 *
 * Intended for opt-in use by callers who want lenient behavior — the
 * default `ctx.json()` path remains strict and surfaces a
 * `RiftexUnserializableError` so the bug is visible.
 *
 * @example
 *   import { safeJsonStringify } from 'riftexpress'
 *   ctx.send(safeJsonStringify(value), 200)
 *   ctx.set('content-type', 'application/json; charset=utf-8')
 */

/** Options for `safeJsonStringify`. */
export interface SafeJsonStringifyOptions {
  /**
   * Pass-through to `JSON.stringify`'s third argument — number of spaces or
   * indent string for pretty-printing. Defaults to no indentation.
   */
  space?: string | number
  /**
   * Optional user replacer applied AFTER the cycle/BigInt sanitization. If
   * provided, behaves like `JSON.stringify`'s second argument.
   */
  replacer?: (key: string, value: unknown) => unknown
}

/**
 * Stringify `value` without throwing on circular structures or `BigInt`s.
 * See module doc for the exact substitution rules.
 */
export function safeJsonStringify(
  value: unknown,
  opts: SafeJsonStringifyOptions = {},
): string {
  const seen = new WeakSet<object>()
  const userReplacer = opts.replacer

  const replacer = (key: string, val: unknown): unknown => {
    let v: unknown = val
    if (typeof v === 'bigint') {
      // Preserve precision by emitting as a JSON string.
      v = v.toString()
    } else if (typeof v === 'object' && v !== null) {
      if (seen.has(v as object)) return '[Circular]'
      seen.add(v as object)
    }
    if (userReplacer) v = userReplacer(key, v)
    return v
  }

  // `JSON.stringify` returns `undefined` for top-level `undefined`,
  // functions, and symbols — normalize to the literal string 'undefined'
  // so the return type contract (`string`) holds.
  const out = JSON.stringify(value, replacer, opts.space)
  return out === undefined ? 'undefined' : out
}
