// @vitest-environment node
/**
 * An Edge Function boots only if every import in its graph resolves. A bare specifier such as
 * `@supabase/supabase-js` resolves only through the import map the function declares in
 * supabase/config.toml; a function without one fails at boot ("Worker failed to boot"), and
 * vitest, which resolves through node_modules, never sees it. whatsapp-service broke this way
 * when it imported _shared/supabase.ts (independent verifier, 2026-11-06): every WhatsApp the
 * platform sends goes through it. Type-only imports are erased and not checked.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SUPABASE_DIR = path.resolve(__dirname, '../../supabase')
const FUNCTIONS_DIR = path.join(SUPABASE_DIR, 'functions')

/** import_map declared per function in config.toml, resolved to an absolute path. */
function importMaps(): Map<string, string> {
  const maps = new Map<string, string>()
  let current: string | null = null
  for (const line of readFileSync(path.join(SUPABASE_DIR, 'config.toml'), 'utf8').split(/\r?\n/)) {
    const section = /^\[functions\.([^\]]+)\]/.exec(line)
    if (section) { current = section[1]!; continue }
    if (/^\[/.test(line)) { current = null; continue }
    const map = /^import_map\s*=\s*"([^"]+)"/.exec(line)
    if (current && map) maps.set(current, path.resolve(SUPABASE_DIR, map[1]!))
  }
  return maps
}

const IMPORT = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
const URL_LIKE = /^(?:npm:|jsr:|node:|https?:)/

function bareImports(entry: string, mapKeys: string[]): Array<{ file: string; specifier: string }> {
  const unresolved: Array<{ file: string; specifier: string }> = []
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return
    seen.add(file)
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const typeOnly = Boolean(m[2])
      const specifier = (m[3] ?? m[4])!
      if (specifier.startsWith('.') || specifier.startsWith('/')) { if (!typeOnly) visit(path.resolve(path.dirname(file), specifier)); continue }
      if (typeOnly || URL_LIKE.test(specifier)) continue
      if (!mapKeys.some((k) => specifier === k || (k.endsWith('/') && specifier.startsWith(k)))) {
        unresolved.push({ file: path.relative(FUNCTIONS_DIR, file), specifier })
      }
    }
  }
  visit(entry)
  return unresolved
}

const functions = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(path.join(FUNCTIONS_DIR, d.name, 'index.ts')))
  .map((d) => d.name)

describe('every Edge Function import resolves at boot', () => {
  const maps = importMaps()
  it.each(functions)('%s', (fn) => {
    const map = maps.get(fn)
    const keys = map && existsSync(map) ? Object.keys((JSON.parse(readFileSync(map, 'utf8')) as { imports?: Record<string, string> }).imports ?? {}) : []
    expect(bareImports(path.join(FUNCTIONS_DIR, fn, 'index.ts'), keys)).toEqual([])
  })
})
