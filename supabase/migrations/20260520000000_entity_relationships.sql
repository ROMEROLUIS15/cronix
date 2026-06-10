-- ─────────────────────────────────────────────────────────────────────────────
-- entity_relationships — graph layer nativo sobre Postgres (Fase 5.a).
--
-- Diseño:
--   • Solo edges "soft" descubiertos por la IA o el consolidador nocturno.
--   • Edges "hard" (client→appointment→service→staff) ya viven en appointments
--     y NO se duplican aquí. Replicarlos sería drift garantizado.
--   • Self-loops permitidos: modelan propiedades unarias al estilo Neo4j
--     (ej. client→client con metadata.window='morning' = "prefiere mañanas").
--   • Población 100% desde app-layer. CERO triggers.
--   • RLS estricta vía public.current_business_id() (igual que ai_memories_v2).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entity_kind') THEN
    CREATE TYPE public.entity_kind AS ENUM (
      'client',
      'service',
      'staff',
      'business',
      'appointment'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'edge_type') THEN
    CREATE TYPE public.edge_type AS ENUM (
      'aliases_with',
      'prefers_time_window'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.entity_relationships (
  id           uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid              NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  from_kind    public.entity_kind NOT NULL,
  from_id      uuid              NOT NULL,
  to_kind      public.entity_kind NOT NULL,
  to_id        uuid              NOT NULL,
  edge_type    public.edge_type  NOT NULL,
  confidence   numeric(4,3)      NOT NULL DEFAULT 1.000 CHECK (confidence BETWEEN 0 AND 1),
  metadata     jsonb             NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz       NOT NULL DEFAULT now(),
  expires_at   timestamptz       NULL
);

COMMENT ON TABLE  public.entity_relationships IS 'Graph soft-edges descubiertos por la IA. Hard-edges viven en appointments.';
COMMENT ON COLUMN public.entity_relationships.confidence IS 'Confianza 0-1 del descubrimiento (consolidador nocturno).';
COMMENT ON COLUMN public.entity_relationships.expires_at IS 'TTL opcional para preferencias que decay.';

-- Idempotencia: la misma (scope, from, to, type) no se duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_relationships
  ON public.entity_relationships (business_id, from_kind, from_id, to_kind, to_id, edge_type);

-- Traversal: vecinos salientes.
CREATE INDEX IF NOT EXISTS idx_entity_relationships_from
  ON public.entity_relationships (business_id, from_kind, from_id, edge_type);

-- Traversal inverso: aristas entrantes.
CREATE INDEX IF NOT EXISTS idx_entity_relationships_to
  ON public.entity_relationships (business_id, to_kind, to_id, edge_type);

-- TTL housekeeping (cron nocturno).
CREATE INDEX IF NOT EXISTS idx_entity_relationships_expires
  ON public.entity_relationships (expires_at)
  WHERE expires_at IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.entity_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY entity_relationships_tenant_select
  ON public.entity_relationships
  FOR SELECT
  TO authenticated
  USING (business_id = public.current_business_id());

CREATE POLICY entity_relationships_tenant_insert
  ON public.entity_relationships
  FOR INSERT
  TO authenticated
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY entity_relationships_tenant_update
  ON public.entity_relationships
  FOR UPDATE
  TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

CREATE POLICY entity_relationships_tenant_delete
  ON public.entity_relationships
  FOR DELETE
  TO authenticated
  USING (business_id = public.current_business_id());

-- service_role bypass implícito; las Edge Functions filtran business_id en cada query.
