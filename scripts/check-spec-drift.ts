/**
 * check-spec-drift.ts — Catch the "dead map" class of spec↔code drift.
 *
 * The SDD audit (G2.1/G2.2/G2.3) found manifests citing files/paths that had
 * moved, been renamed, or never existed. This script parses docs/specs/ and
 * verifies that every file path cited in backticks still resolves on disk.
 *
 * It does NOT validate semantics (impossible to check that prose matches
 * behaviour) — only that the DESCRIPTIVE file references in the specs are real.
 * A cited path that no longer exists is a guaranteed hallucination trap for the
 * next agent that reads the spec.
 *
 * Usage:  npx tsx scripts/check-spec-drift.ts
 * Exit 0 = all cited paths resolve. Exit 1 = at least one dead reference.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SPECS_DIR = join(ROOT, 'docs', 'specs')

// First path segment must be one of these real repo roots for a token to count
// as a file reference (filters out identifiers like `business_id`, `Result<T>`).
const PATH_ROOTS = new Set([
  'lib', 'app', 'components', 'supabase', '__tests__', 'tests', 'docs',
  'scripts', 'middleware', 'hooks', 'types', 'i18n', 'public', '.github',
  '.agent', '.husky',
])

const FILE_EXT = /\.(ts|tsx|js|jsx|sql|md|json|css|toml|mjs|cjs)$/

interface DeadRef {
  specFile: string
  line: number
  ref: string
}

function collectMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectMarkdown(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

/** A backtick token looks like a repo path if it starts at a known root and is
 *  either a file (has an extension) or a directory (ends with '/'). */
function looksLikePath(token: string): boolean {
  if (/\s/.test(token)) return false
  const first = token.split('/')[0] ?? ''
  if (!PATH_ROOTS.has(first)) return false
  return FILE_EXT.test(token) || token.endsWith('/')
}

/** Strip a trailing :line / :line:col suffix and any leading ./ */
function normalize(token: string): string {
  return token.replace(/^\.\//, '').replace(/:\d+(:\d+)?$/, '')
}

function checkFile(specFile: string): DeadRef[] {
  const dead: DeadRef[] = []
  const lines = readFileSync(specFile, 'utf8').split(/\r?\n/)
  lines.forEach((lineText, i) => {
    for (const m of lineText.matchAll(/`([^`]+)`/g)) {
      const raw = m[1]!.trim()
      if (!looksLikePath(raw)) continue
      const rel = normalize(raw)
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) {
        dead.push({ specFile, line: i + 1, ref: raw })
      } else if (rel.endsWith('/') && !statSync(abs).isDirectory()) {
        dead.push({ specFile, line: i + 1, ref: raw })
      }
    }
  })
  return dead
}

function main(): void {
  if (!existsSync(SPECS_DIR)) {
    console.error(`spec-drift: ${SPECS_DIR} not found`)
    process.exit(1)
  }

  const specFiles = collectMarkdown(SPECS_DIR)
  const dead: DeadRef[] = specFiles.flatMap(checkFile)

  if (dead.length === 0) {
    console.log(`spec-drift: OK — all file paths cited in docs/specs/ resolve (${specFiles.length} specs scanned).`)
    return
  }

  console.error(`spec-drift: ${dead.length} dead path reference(s) in docs/specs/:\n`)
  for (const d of dead) {
    const rel = d.specFile.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/')
    console.error(`  ${rel}:${d.line}  →  \`${d.ref}\`  (not found on disk)`)
  }
  console.error(`\nFix the spec to match the code (descriptive refs follow the code), or restore the path.`)
  process.exit(1)
}

main()
