/**
 * test-router.ts — Manual smoke test for the SemanticRouter.
 *
 * Calls the real embed-text Edge Function with whatever text you pass in,
 * matches against the committed intent-embeddings.generated.json, and
 * prints the top intent.
 *
 *   npx tsx scripts/test-router.ts "quiero apartar una cita pa mañana"
 *   npx tsx scripts/test-router.ts "cancela mi cita"
 *   npx tsx scripts/test-router.ts "qué horarios tienes libres"
 *
 * Required env (read from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as dotenv from 'dotenv'
import { SupabaseEdgeEmbedder } from '../lib/ai/memory/Embedder'
import { SemanticRouter }       from '../lib/ai/router/SemanticRouter'
import type { IntentPrototype } from '../lib/ai/router/contracts'
import embeddings from '../lib/ai/router/intent-embeddings.generated.json'

dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const text = process.argv.slice(2).join(' ').trim()
if (!text) {
  console.error('Usage: npx tsx scripts/test-router.ts "<your phrase>"')
  process.exit(1)
}

async function main(): Promise<void> {
  const prototypes = (embeddings as { prototypes: IntentPrototype[] }).prototypes
  if (prototypes.length === 0) {
    console.error('❌ intent-embeddings.generated.json is empty. Run: npm run seed:intents')
    process.exit(1)
  }

  const embedder = new SupabaseEdgeEmbedder(
    `${SUPABASE_URL}/functions/v1/embed-text`,
    SERVICE_KEY!,
    fetch,
    30_000,
  )
  const router = new SemanticRouter(embedder, prototypes, (stage, error) => {
    console.error(`⚠️  ${stage}: ${error}`)
  })

  console.log(`🔍 Classifying: "${text}"`)
  console.log(`   (${prototypes.length} prototypes loaded)\n`)

  const start  = Date.now()
  const result = await router.classify(text)
  const ms     = Date.now() - start

  if (!result) {
    console.log(`❓ No intent matched (threshold 0.78). Latency: ${ms} ms`)
    return
  }

  console.log(`✓ intent      : ${result.intent}`)
  console.log(`  confidence  : ${(result.confidence * 100).toFixed(1)}%`)
  console.log(`  matched     : "${result.matched}"`)
  console.log(`  latency     : ${ms} ms`)
}

main().catch((err) => {
  console.error('💥 Error:', err)
  process.exit(1)
})
