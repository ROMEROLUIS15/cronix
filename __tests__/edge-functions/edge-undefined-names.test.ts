// @vitest-environment node
/**
 * An undefined name in an Edge Function only fails at runtime, inside whichever `catch` is
 * nearest: `npm run typecheck` does not cover `supabase/functions`, and CI runs no `deno
 * check`. A `supabase` left undefined in notif-channels.ts silently stopped every owner
 * WhatsApp alert this way (2026-10-28). Compiling each file alone (noResolve) keeps this
 * fast and limits it to the errors that cannot come from a missing Deno import map.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const FUNCTIONS_DIR = path.resolve(__dirname, '../../supabase/functions')
/** Globals of the Deno edge runtime, which no lib file declares. */
const RUNTIME_GLOBALS = new Set(['Deno', 'EdgeRuntime', 'Supabase'])
const CANNOT_FIND_NAME = new Set([2304, 2552])

function isProductionSource(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')
    && !name.split(path.sep).includes('__tests__')
}

function edgeFunctionFiles(): string[] {
  return readdirSync(FUNCTIONS_DIR, { recursive: true, encoding: 'utf8' })
    .filter(isProductionSource)
    .map((name) => path.join(FUNCTIONS_DIR, name))
}

function findUndefinedNames(files: string[]): string[] {
  const program = ts.createProgram(files, {
    noEmit: true,
    noResolve: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
  })
  return files.flatMap((file) => {
    const source = program.getSourceFile(file)
    return program.getSemanticDiagnostics(source)
      .filter((d) => CANNOT_FIND_NAME.has(d.code) && d.file && d.start !== undefined)
      .filter((d) => !RUNTIME_GLOBALS.has(d.file!.text.slice(d.start!, d.start! + d.length!)))
      .map((d) => {
        const { line } = d.file!.getLineAndCharacterOfPosition(d.start!)
        return `${path.relative(FUNCTIONS_DIR, d.file!.fileName)}:${line + 1} ${d.file!.text.slice(d.start!, d.start! + d.length!)}`
      })
  })
}

describe('Edge Functions have no undefined names', () => {
  it('finds a name that is not defined, and accepts the runtime globals', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'edge-names-'))
    const file = path.join(dir, 'sample.ts')
    try {
      writeFileSync(file, 'export const a = Deno.env.get("A")\nexport const b = supabase.from("t")\n')
      const found = findUndefinedNames([file])
      expect(found).toHaveLength(1)
      expect(found[0]).toMatch(/:2 supabase$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('none in supabase/functions', () => {
    const files = edgeFunctionFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(findUndefinedNames(files)).toEqual([])
  }, 60_000)
})
