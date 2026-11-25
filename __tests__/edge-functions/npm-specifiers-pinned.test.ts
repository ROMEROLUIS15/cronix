/**
 * npm-specifiers-pinned.test.ts — every `npm:` import in the Edge Functions names a version.
 *
 * Functions without a deno.lock resolve an unpinned `npm:` import to the latest release
 * at deploy time. On 2026-11-22 `npm:@sentry/deno` resolved to 11.16.0, which crashes the
 * edge runtime on init, and a routine redeploy took whatsapp-service down (every outgoing
 * WhatsApp stopped). Sentry is pinned exactly because it is loaded by every function.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'supabase', 'functions')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name === '__tests__') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return name.endsWith('.ts') ? [path] : []
  })
}

const SPECIFIER = /['"]npm:((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(@[^'"/]+)?[^'"]*['"]/gi

function npmImports(): Array<{ file: string; pkg: string; version: string | null }> {
  return sourceFiles(ROOT).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].map((m) => ({
      file: file.slice(ROOT.length + 1),
      pkg: m[1] ?? '',
      version: m[2] ? m[2].slice(1) : null,
    })),
  )
}

describe('Edge Function npm imports', () => {
  it('finds the npm imports it is meant to guard', () => {
    expect(npmImports().length).toBeGreaterThan(0)
  })

  it('never imports an npm package without a version', () => {
    const unpinned = npmImports().filter((i) => !i.version)
    expect(unpinned).toEqual([])
  })

  it('pins @sentry/deno to an exact version', () => {
    const sentry = npmImports().filter((i) => i.pkg === '@sentry/deno')
    expect(sentry.length).toBeGreaterThan(0)
    for (const i of sentry) expect(i.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
