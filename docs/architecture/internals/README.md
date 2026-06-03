# Internals — Cronix

Documentación profunda de las piezas que sostienen la arquitectura. Cada archivo cubre un componente verificado contra el código real.

| Pieza | Doc |
|---|---|
| Constitutional Reviewer (supervisor) | [SUPERVISOR.md](./SUPERVISOR.md) |
| Semantic Router (pgvector + cosine) | [SEMANTIC_ROUTER.md](./SEMANTIC_ROUTER.md) |
| Memoria episódica (`ai_memories_v2`) | [MEMORY.md](./MEMORY.md) |
| Observabilidad de IA (`ai_traces`) | [OBSERVABILITY.md](./OBSERVABILITY.md) |
| Pipeline de training-data | [TRAINING_PIPELINE.md](./TRAINING_PIPELINE.md) |
| Voice-worker capability registry | [VOICE_CAPABILITY_REGISTRY.md](./VOICE_CAPABILITY_REGISTRY.md) |
| Parity Node ↔ Deno (`_shared/`) | [SHARED_PARITY.md](./SHARED_PARITY.md) |
| LLM Provider Fallback Chain | [PROVIDER_FALLBACK.md](./PROVIDER_FALLBACK.md) |
| RPC `fn_finalize_paypal_payment` | [PAYPAL_RPC_DESIGN.md](./PAYPAL_RPC_DESIGN.md) |
| Edge Function `embed-text` | [EMBED_TEXT_FUNCTION.md](./EMBED_TEXT_FUNCTION.md) |
