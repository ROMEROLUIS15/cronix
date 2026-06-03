/**
 * bench-latency.ts — Latencia real de las piezas pure-JS del agente.
 *
 * Mide componentes deterministas (sin red, sin BD, sin LLM):
 *   1. SemanticRouter.classify       — cosine similarity sobre 9 prototipos
 *   2. mapResponseToVerdict           — traducción del veredicto del reviewer
 *
 * NO mide:
 *   - Groq / Deepgram (red)
 *   - PostgreSQL roundtrip
 *   - Edge Function cold start
 *
 * Ejecutar: npx tsx scripts/bench-latency.ts
 */

import { SemanticRouter } from '../lib/ai/router/SemanticRouter'
import type { IEmbedder, IntentPrototype } from '../lib/ai/router/contracts'
import embeddingsFile from '../lib/ai/router/intent-embeddings.generated.json'

const ITERATIONS = 10_000

function bench(label: string, fn: () => void): { label: string; iters: number; totalMs: number; perOpUs: number } {
  // Warmup
  for (let i = 0; i < 100; i++) fn()

  const start = process.hrtime.bigint()
  for (let i = 0; i < ITERATIONS; i++) fn()
  const end = process.hrtime.bigint()

  const totalMs = Number(end - start) / 1_000_000
  const perOpUs = (totalMs * 1000) / ITERATIONS
  return { label, iters: ITERATIONS, totalMs, perOpUs }
}

// ── 1. SemanticRouter.classify ───────────────────────────────────────────────
const prototypes = (embeddingsFile as { prototypes: IntentPrototype[] }).prototypes
const FIXED_EMBED = prototypes[0]!.embedding

const mockEmbedder: IEmbedder = {
  dimensions: 384,
  embed: async () => ({ ok: true, value: FIXED_EMBED }),
}
const router = new SemanticRouter(mockEmbedder, prototypes)

// classify is async but the embed is in-memory, so we can measure via a sync wrapper
async function benchAsync(label: string, fn: () => Promise<unknown>, iters: number) {
  for (let i = 0; i < 100; i++) await fn()  // warmup

  const start = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) await fn()
  const end = process.hrtime.bigint()

  const totalMs = Number(end - start) / 1_000_000
  const perOpUs = (totalMs * 1000) / iters
  return { label, iters, totalMs, perOpUs }
}

// ── 2. mapResponseToVerdict (constitutional reviewer mapping) ────────────────
// Inline since the helper is not exported — same logic as in ConstitutionalReviewer.ts
type ReviewVerdict =
  | { ok: true }
  | { ok: false; severity: 'block' | 'warn'; code: string; reason: string }

function mapResponseToVerdict(res: { verdict: string; code: string | null; reason: string }): ReviewVerdict {
  if (res.verdict === 'allow') return { ok: true }
  const severity = res.verdict === 'block' ? 'block' : 'warn'
  const code     = res.code ?? 'POLICY_VIOLATION'
  const reason   = res.reason.trim().slice(0, 140) || 'sin razón especificada'
  return { ok: false, severity, code, reason }
}
const TYPICAL_VERDICT_RESPONSE = {
  verdict: 'block',
  code:    'AMBIGUOUS_TARGET',
  reason:  'dos clientes con nombre similar en la memoria reciente',
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  const results: Array<ReturnType<typeof bench>> = []

  // SemanticRouter (async due to mocked embedder)
  const r1 = await benchAsync(
    'SemanticRouter.classify (9 prototipos × 384 dims)',
    () => router.classify('quiero agendar una cita mañana a las 3pm'),
    ITERATIONS,
  )
  results.push(r1)

  results.push(bench(
    'mapResponseToVerdict (reviewer mapping)',
    () => { mapResponseToVerdict(TYPICAL_VERDICT_RESPONSE) },
  ))

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  Latencia de piezas pure-JS del agente (sin red, sin BD, sin LLM)')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('')

  const maxLabel = Math.max(...results.map(r => r.label.length))
  for (const r of results) {
    const label  = r.label.padEnd(maxLabel)
    const perOp  = r.perOpUs < 1
      ? `${(r.perOpUs * 1000).toFixed(0)} ns/op`
      : r.perOpUs < 1000
        ? `${r.perOpUs.toFixed(2)} µs/op`
        : `${(r.perOpUs / 1000).toFixed(2)} ms/op`
    console.log(`  ${label}   →   ${perOp.padStart(14)}   (${r.iters.toLocaleString()} iter, ${r.totalMs.toFixed(1)} ms total)`)
  }

  // Aggregate
  const totalPerTurnUs = results.reduce((sum, r) => sum + r.perOpUs, 0)
  console.log('')
  console.log('───────────────────────────────────────────────────────────────────')
  console.log(`  Suma por turno (las 2 piezas)                →   ${totalPerTurnUs < 1000 ? totalPerTurnUs.toFixed(2) + ' µs' : (totalPerTurnUs / 1000).toFixed(2) + ' ms'}`)
  console.log('───────────────────────────────────────────────────────────────────')
  console.log('')
  console.log('  Nota: la latencia end-to-end del agente está dominada por la red:')
  console.log('   - Groq LLM call:  ~200–600 ms  (cada step del ReAct loop)')
  console.log('   - Deepgram STT:   ~300–500 ms  (notas de voz)')
  console.log('   - Postgres RPC:   ~50–200 ms   (por roundtrip)')
  console.log('  El cómputo en memoria del agente NO es el cuello de botella.')
  console.log('')
}

main().catch(err => { console.error(err); process.exit(1) })
