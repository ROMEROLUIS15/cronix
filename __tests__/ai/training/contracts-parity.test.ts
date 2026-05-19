/**
 * contracts-parity.test.ts — Prevent drift between Node and Deno mirrors of
 * the training-export layer.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

describe('training parity (Node ↔ Deno)', () => {
  const root = resolve(__dirname, '../../..')

  function read(rel: string): string {
    return readFileSync(resolve(root, rel), 'utf8')
  }

  it('contracts.ts is byte-identical across runtimes', () => {
    const node = read('lib/ai/training/contracts.ts')
    const deno = read('supabase/functions/_shared/training/contracts.ts')
    expect(deno).toBe(node)
  })

  it('TrainingExporter.ts is identical modulo the .ts suffix on relative imports', () => {
    const node = read('lib/ai/training/TrainingExporter.ts')
    const deno = read('supabase/functions/_shared/training/TrainingExporter.ts')
    const norm = (s: string) => s.replace(/from\s+['"]\.\/(contracts)\.ts['"]/g, "from './$1'")
    expect(norm(deno)).toBe(norm(node))
  })
})
