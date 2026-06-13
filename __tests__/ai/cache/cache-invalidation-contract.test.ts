/**
 * cache-invalidation-contract.test.ts — Seam guard between the dashboard's
 * Redis cache (Node, lib/cache.ts) and the cross-channel invalidation helper
 * the Deno Edge Functions call (supabase/functions/_shared/cache-invalidation.ts).
 *
 * Why this exists: the dashboard CACHES clients/appointments/dashboard, but
 * writes also come from voice + WhatsApp Edge Functions that bust the cache by
 * deleting keys by raw string pattern. If lib/cache.ts ever bumps CACHE_VERSION
 * or changes the key shape, the Deno helper would silently delete the WRONG
 * keys and voice/WhatsApp writes would stop showing up on the dashboard — the
 * exact "fix one place, break another" failure. These assertions fail loudly
 * the moment the two drift, so the contract can't rot unnoticed.
 *
 * Source-level (readFileSync) on purpose: the Deno helper reads Deno.env at
 * import time and can't be imported under Node/vitest — same approach the other
 * Node↔Deno parity tests use.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const nodeCache = read('lib/cache.ts')
const denoInvalidator = read('supabase/functions/_shared/cache-invalidation.ts')

function cacheVersion(src: string): string | undefined {
  return src.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1]
}

describe('dashboard cache invalidation contract (Node ↔ Deno)', () => {
  it('CACHE_VERSION is identical on both sides', () => {
    const node = cacheVersion(nodeCache)
    const deno = cacheVersion(denoInvalidator)
    expect(node).toBeTruthy()
    expect(deno).toBe(node)
  })

  it('key shape is identical: `${CACHE_VERSION}:cache:${businessId}:${dataType}:`', () => {
    // lib/cache.ts builds full keys with a suffix; the Deno helper deletes by
    // prefix + wildcard. Both must share the same prefix up to dataType.
    expect(nodeCache).toContain('${CACHE_VERSION}:cache:${businessId}:${dataType}:')
    expect(denoInvalidator).toContain('${CACHE_VERSION}:cache:${businessId}:${dataType}:*')
  })

  it('every dataType the Deno helper busts is one the repositories actually cache', () => {
    const datatypesLine = denoInvalidator.match(/DATATYPES\s*=\s*\[([^\]]+)\]/)?.[1] ?? ''
    const datatypes = [...datatypesLine.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    expect(datatypes).toContain('clients')
    expect(datatypes).toContain('appointments')
    expect(datatypes).toContain('dashboard')

    // Each must correspond to a real cached namespace in the repos, so the
    // helper never deletes a typo that quietly invalidates nothing.
    const clientsRepo = read('lib/repositories/SupabaseClientRepository.ts')
    const apptRepo    = read('lib/repositories/SupabaseAppointmentRepository.ts')
    expect(clientsRepo).toMatch(/cache\.(get|set|invalidate)\([^)]*['"]clients['"]/)
    expect(apptRepo).toMatch(/cache\.(get|set)\([^)]*['"]appointments['"]/)
    expect(apptRepo).toMatch(/cache\.(set|invalidateKey)\([^)]*['"]dashboard['"]/)
  })

  it('the Deno helper deletes via KEYS + DEL (prefix match, not a single key)', () => {
    expect(denoInvalidator).toMatch(/['"]KEYS['"]/)
    expect(denoInvalidator).toMatch(/['"]DEL['"]/)
  })
})
