/**
 * contracts-parity.test.ts — Prevent drift between Node and Deno mirrors.
 *
 * Files that MUST stay byte-identical (or identical modulo runtime concessions):
 *   - lib/ai/supervisor/contracts.ts          ↔ supabase/functions/_shared/supervisor/contracts.ts
 *   - lib/ai/supervisor/rubric.ts             ↔ supabase/functions/_shared/supervisor/rubric.ts
 *   - lib/ai/supervisor/ConstitutionalReviewer.ts ↔ … (modulo .ts suffix on imports)
 *   - lib/ai/supervisor/GroqReviewerLlm.ts    ↔ … (modulo .ts suffix + zod import)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

describe('supervisor parity (Node ↔ Deno)', () => {
  const root = resolve(__dirname, '../../..')

  function read(rel: string): string {
    return readFileSync(resolve(root, rel), 'utf8')
  }

  it('contracts.ts is byte-identical across runtimes', () => {
    const node = read('lib/ai/supervisor/contracts.ts')
    const deno = read('supabase/functions/_shared/supervisor/contracts.ts')
    expect(deno).toBe(node)
  })

  it('rubric.ts is byte-identical across runtimes', () => {
    const node = read('lib/ai/supervisor/rubric.ts')
    const deno = read('supabase/functions/_shared/supervisor/rubric.ts')
    expect(deno).toBe(node)
  })

  it('ConstitutionalReviewer.ts is identical modulo the .ts suffix on relative imports', () => {
    const node = read('lib/ai/supervisor/ConstitutionalReviewer.ts')
    const deno = read('supabase/functions/_shared/supervisor/ConstitutionalReviewer.ts')
    const norm = (s: string) => s.replace(/from\s+['"]\.\/(contracts|rubric)\.ts['"]/g, "from './$1'")
    expect(norm(deno)).toBe(norm(node))
  })

  it('GroqReviewerLlm.ts is identical modulo .ts suffix and zod import specifier', () => {
    const node = read('lib/ai/supervisor/GroqReviewerLlm.ts')
    const deno = read('supabase/functions/_shared/supervisor/GroqReviewerLlm.ts')
    const norm = (s: string) =>
      s
        .replace(/from\s+['"]\.\/(contracts|rubric)\.ts['"]/g, "from './$1'")
        .replace(/from\s+['"]https:\/\/esm\.sh\/zod@[\d.]+['"]/g, "from 'zod'")
    expect(norm(deno)).toBe(norm(node))
  })

  it('guard.ts is identical modulo the .ts suffix on relative imports', () => {
    const node = read('lib/ai/supervisor/guard.ts')
    const deno = read('supabase/functions/_shared/supervisor/guard.ts')
    const norm = (s: string) => s.replace(/from\s+['"]\.\/(contracts)\.ts['"]/g, "from './$1'")
    expect(norm(deno)).toBe(norm(node))
  })
})
