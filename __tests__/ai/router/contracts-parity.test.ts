/**
 * contracts-parity.test.ts — Prevent drift between Node and Deno mirrors.
 *
 * Files that MUST stay byte-identical:
 *   - lib/ai/router/contracts.ts
 *   - lib/ai/router/SemanticRouter.ts (modulo import suffix .ts)
 *   - supabase/functions/_shared/router/contracts.ts
 *   - supabase/functions/_shared/router/SemanticRouter.ts
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve }      from 'node:path'

describe('router parity (Node ↔ Deno)', () => {
  const root = resolve(__dirname, '../../..')

  it('contracts.ts is byte-identical across runtimes', () => {
    const node = readFileSync(resolve(root, 'lib/ai/router/contracts.ts'), 'utf8')
    const deno = readFileSync(resolve(root, 'supabase/functions/_shared/router/contracts.ts'), 'utf8')
    expect(deno).toBe(node)
  })

  it('SemanticRouter.ts is identical modulo the .ts suffix on relative imports', () => {
    // Deno needs explicit .ts on relative imports; Node forbids it. Normalize both.
    const node = readFileSync(resolve(root, 'lib/ai/router/SemanticRouter.ts'), 'utf8')
    const deno = readFileSync(resolve(root, 'supabase/functions/_shared/router/SemanticRouter.ts'), 'utf8')
    const norm = (s: string) => s.replace(/from\s+['"]\.\/(contracts)\.ts['"]/g, "from './$1'")
    expect(norm(deno)).toBe(norm(node))
  })
})
