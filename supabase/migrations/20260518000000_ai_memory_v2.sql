-- ─────────────────────────────────────────────────────────────────────────────
-- Memoria episódica v2 — gte-small (384 dims), tenant-safe, HNSW indexed.
--
-- Diseño:
--   • Tabla nueva. ai_memories legacy queda deprecada (drop en migración futura).
--   • actor_kind/actor_key generaliza el sujeto del recuerdo:
--       'user'         → owner del dashboard       (actor_key = users.id::text)
--       'client_phone' → cliente de WhatsApp       (actor_key = E.164 normalizado)
--   • RLS estricta: solo el tenant dueño puede leer/escribir.
--   • Index HNSW sobre embedding + B-tree compuesto sobre el scope.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.ai_memories_v2 (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid         NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_kind   text         NOT NULL CHECK (actor_kind IN ('user', 'client_phone')),
  actor_key    text         NOT NULL,
  kind         text         NOT NULL CHECK (kind IN ('episodic', 'preference', 'fact')),
  content      text         NOT NULL,
  embedding    vector(384)  NOT NULL,
  metadata     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NULL
);

COMMENT ON TABLE  public.ai_memories_v2 IS 'Memoria del agente (episódica/preferencias/hechos). gte-small 384 dims.';
COMMENT ON COLUMN public.ai_memories_v2.actor_kind IS 'Origen del sujeto: user (dashboard) o client_phone (WhatsApp).';
COMMENT ON COLUMN public.ai_memories_v2.expires_at IS 'TTL opcional — cron nocturno limpia rows vencidos.';

-- B-tree para scoping rápido ANTES de la búsqueda vectorial.
CREATE INDEX IF NOT EXISTS idx_ai_memories_v2_scope
  ON public.ai_memories_v2 (business_id, actor_kind, actor_key, created_at DESC);

-- HNSW para similitud coseno (gte-small está normalizado).
CREATE INDEX IF NOT EXISTS idx_ai_memories_v2_embedding_hnsw
  ON public.ai_memories_v2
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- TTL housekeeping helper (idempotente; pg_cron lo invoca en Fase 5).
CREATE INDEX IF NOT EXISTS idx_ai_memories_v2_expires
  ON public.ai_memories_v2 (expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_memories_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_memories_v2_tenant_select
  ON public.ai_memories_v2
  FOR SELECT
  TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY ai_memories_v2_tenant_insert
  ON public.ai_memories_v2
  FOR INSERT
  TO authenticated
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY ai_memories_v2_tenant_delete
  ON public.ai_memories_v2
  FOR DELETE
  TO authenticated
  USING (business_id = public.current_business_id());

-- service_role bypass es implícito (RLS no aplica al service role).
-- Las Edge Functions ya entran como service_role; la barrera real para ellas
-- es el filtro WHERE business_id = $1 en cada query (defense in depth).

-- ─── RPC tipada para búsqueda por similitud (filtra tenant ANTES) ────────────
CREATE OR REPLACE FUNCTION public.match_ai_memories_v2(
  p_business_id      uuid,
  p_actor_kind       text,
  p_actor_key        text,
  p_query_embedding  vector(384),
  p_match_threshold  double precision DEFAULT 0.78,
  p_match_count      integer          DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  content     text,
  kind        text,
  metadata    jsonb,
  similarity  double precision,
  created_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.content,
    m.kind,
    m.metadata,
    1 - (m.embedding <=> p_query_embedding) AS similarity,
    m.created_at
  FROM public.ai_memories_v2 AS m
  WHERE m.business_id = p_business_id
    AND m.actor_kind  = p_actor_kind
    AND m.actor_key   = p_actor_key
    AND (m.expires_at IS NULL OR m.expires_at > now())
    AND 1 - (m.embedding <=> p_query_embedding) >= p_match_threshold
  ORDER BY m.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
$$;

REVOKE ALL ON FUNCTION public.match_ai_memories_v2(uuid, text, text, vector, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_memories_v2(uuid, text, text, vector, double precision, integer) TO authenticated, service_role;
