import type { ComposedHandler } from '../middleware/types.ts'
import type { HttpMethod } from './types.ts'

/**
 * One node in the radix trie. Static segments win over `:param`, which wins
 * over `*wild`. Method-specific composed handlers live at the leaf.
 */
export class TrieNode {
  staticChildren: Map<string, TrieNode> = new Map()
  paramChild: TrieNode | null = null
  paramName: string | null = null
  wildcardChild: TrieNode | null = null
  wildcardName: string | null = null

  /** Per-method composed handlers, populated by `RouteRegistry` after compose. */
  handlers: Partial<Record<HttpMethod, ComposedHandler>> = {}

  /**
   * Param names accumulated from root → this node, in order. Cached so
   * matching can fill the params object in O(k) without re-walking parents.
   */
  paramNames: readonly string[] = []
}

/** Result of a trie lookup. `params` may be empty if the route had none. */
export interface MatchResult {
  handler: ComposedHandler
  params: Record<string, string>
  /** Methods registered at this leaf — used to populate `Allow` on 405. */
  allowed: readonly HttpMethod[]
}

/** Why a lookup failed. */
export type MatchMiss =
  | { kind: 'not-found' }
  | { kind: 'method-not-allowed'; allowed: readonly HttpMethod[] }

/**
 * Radix trie router. `insert()` is called at registration; `find()` runs on
 * every request and is the single hottest piece of code in the framework.
 */
export class RouterTrie {
  readonly root = new TrieNode()

  /**
   * Walks/creates trie nodes for the path. Returns the leaf where handlers
   * should be attached. Path must start with `/`.
   */
  insert(path: string): TrieNode {
    if (path.length === 0 || path[0] !== '/') {
      throw new Error(`Route path must start with '/': ${path}`)
    }
    const segments = splitPath(path)
    let node = this.root
    const paramNames: string[] = []

    for (const seg of segments) {
      if (seg.length === 0) continue

      if (seg[0] === ':') {
        const name = seg.slice(1).replace(/\?$/, '')
        if (!node.paramChild) {
          node.paramChild = new TrieNode()
          node.paramName = name
        } else if (node.paramName !== name) {
          throw new Error(
            `Conflicting param names at the same trie level: ':${node.paramName}' vs ':${name}'`,
          )
        }
        paramNames.push(name)
        node = node.paramChild
      } else if (seg[0] === '*') {
        const name = seg.slice(1) || 'wildcard'
        if (!node.wildcardChild) {
          node.wildcardChild = new TrieNode()
          node.wildcardName = name
        }
        paramNames.push(name)
        node = node.wildcardChild
        // Wildcards consume the rest of the path; later segments are ignored
        // by the matcher anyway, but we don't allow more registration past *.
        break
      } else {
        let child = node.staticChildren.get(seg)
        if (!child) {
          child = new TrieNode()
          node.staticChildren.set(seg, child)
        }
        node = child
      }
    }

    node.paramNames = paramNames
    return node
  }

  /**
   * Look up a route. Iterative with single-level wildcard backtrack — if the
   * static/param walk dead-ends and an ancestor had a `*wildcard` child, we
   * retry from the wildcard with the remaining segments. Backtrack frames
   * are tracked in a small stack (one per wildcard ancestor encountered).
   */
  find(method: HttpMethod, path: string): MatchResult | MatchMiss {
    const segments = splitPath(path)

    // Stack of wildcard fallback points. `paramCount` is paramValues.length
    // captured at the moment the fallback was recorded — used to truncate
    // any params collected past that point if we have to backtrack.
    type Fallback = { node: TrieNode; segIdx: number; paramCount: number }
    const fallbacks: Fallback[] = []

    let node: TrieNode = this.root
    const paramValues: string[] = []
    let consumedWildcard = false

    let i = 0
    walk: while (i < segments.length) {
      const seg = segments[i]!
      if (seg.length === 0) {
        i++
        continue
      }

      // Record a wildcard fallback at this level *before* descending, so a
      // later miss can rewind and consume from `i` greedily via the wildcard.
      if (node.wildcardChild) {
        fallbacks.push({ node: node.wildcardChild, segIdx: i, paramCount: paramValues.length })
      }

      const staticChild = node.staticChildren.get(seg)
      if (staticChild) {
        node = staticChild
        i++
        continue
      }

      if (node.paramChild) {
        paramValues.push(decodeParam(seg))
        node = node.paramChild
        i++
        continue
      }

      if (node.wildcardChild) {
        const remaining = segments.slice(i).join('/')
        paramValues.push(decodeParam(remaining))
        node = node.wildcardChild
        consumedWildcard = true
        break walk
      }

      // Dead end — try the most recent wildcard fallback.
      const fb = fallbacks.pop()
      if (!fb) return { kind: 'not-found' }
      const remaining = segments.slice(fb.segIdx).join('/')
      paramValues.length = fb.paramCount
      paramValues.push(decodeParam(remaining))
      node = fb.node
      consumedWildcard = true
      break walk
    }

    if (!consumedWildcard && !node.handlers[method] && fallbacks.length > 0) {
      // Walked to the end via static/param but no handler at this leaf —
      // try the most recent wildcard fallback.
      const fb = fallbacks.pop()!
      const remaining = segments.slice(fb.segIdx).join('/')
      paramValues.length = fb.paramCount
      paramValues.push(decodeParam(remaining))
      node = fb.node
    }

    const handler = node.handlers[method]
    if (!handler) {
      const allowed = Object.keys(node.handlers) as HttpMethod[]
      if (allowed.length === 0) return { kind: 'not-found' }
      return { kind: 'method-not-allowed', allowed }
    }

    // Build params object — one allocation per match. Stable key insertion
    // order (driven by paramNames recorded at insert time) → V8 monomorphic
    // hidden class per route.
    let params: Record<string, string>
    if (node.paramNames.length === 0) {
      params = EMPTY_PARAMS
    } else {
      params = {}
      for (let j = 0; j < node.paramNames.length; j++) {
        params[node.paramNames[j]!] = paramValues[j]!
      }
    }

    return {
      handler,
      params,
      allowed: Object.keys(node.handlers) as HttpMethod[],
    }
  }
}

/** Shared frozen empty-params sentinel — exported so the dispatcher can identity-compare. */
export const EMPTY_PARAMS: Record<string, string> = Object.freeze({}) as Record<string, string>

/**
 * Split `/users/42/posts` into `['users', '42', 'posts']`. Reused by both
 * insert and lookup, so the implementation is hot — manual scan beats
 * `String.prototype.split` only marginally; we use split for clarity.
 */
function splitPath(path: string): string[] {
  // Strip leading and trailing slash for a stable segment count.
  let start = 0
  let end = path.length
  if (start < end && path[start] === '/') start++
  if (end > start && path[end - 1] === '/') end--
  if (start >= end) return []
  return path.slice(start, end).split('/')
}

function decodeParam(raw: string): string {
  // Hot path: skip decode if no '%' present.
  if (raw.indexOf('%') === -1) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
