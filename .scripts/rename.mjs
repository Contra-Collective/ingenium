#!/usr/bin/env node
// Word-boundary rename: rex → riftex, Rex* → Riftex*
// Run from repo root: node .scripts/rename.mjs

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROOT = process.cwd()
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', '.scripts'])
const EXCLUDE_FILES = new Set(['package-lock.json'])
const INCLUDE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.md', '.json', '.yml', '.yaml', '.mjs'])

// Substitutions in priority order. Word-boundary anchors keep `regex`,
// `prefix`, etc. untouched.
const subs = [
  // Capitalized identifiers — match Rex followed by an uppercase letter (RexApp, RexContext, RexBody…) or word boundary.
  [/\bRex(?=[A-Z])/g, 'Riftex'],
  [/\bRex\b/g, 'Riftex'],
  // Lowercase rex — function name, attached helper namespace, variable.
  [/\brex\b/g, 'riftex'],
]

let touched = 0
let edits = 0

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name) || EXCLUDE_FILES.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full)
      continue
    }
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot) : ''
    if (!INCLUDE_EXT.has(ext)) continue
    rewrite(full)
  }
}

function rewrite(path) {
  const before = readFileSync(path, 'utf8')
  let after = before
  let fileEdits = 0
  for (const [pat, repl] of subs) {
    after = after.replace(pat, (m) => {
      fileEdits++
      return typeof repl === 'function' ? repl(m) : repl
    })
  }
  if (after !== before) {
    writeFileSync(path, after, 'utf8')
    touched++
    edits += fileEdits
    console.log(`  ${fileEdits.toString().padStart(4)} edits  ${path.replace(ROOT + sep, '')}`)
  }
}

walk(ROOT)
console.log(`\nDone: ${touched} files modified, ${edits} edits.`)
