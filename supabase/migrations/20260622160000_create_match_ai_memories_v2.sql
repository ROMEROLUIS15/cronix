-- 20260622160000_create_match_ai_memories_v2.sql
-- Close a migration drift: match_ai_memories_v2 existed in production but NO
-- migration created it — 20260518000000_ai_memory_v2.sql left it as a "-- Placeholder
-- ... will be created in a separate patch" that was never committed. A fresh
-- deploy / local stack therefore lacked the function and the agent's episodic
-- memory recall would silently break. This captures the live definition verbatim.
--
-- Tenant model: SECURITY DEFINER, but locked to service_role only (its sole
-- caller is the Deno/Node agent runtime via the service_role key — see
-- PgVectorEpisodicStore). It is NOT browser-reachable, consistent with the
-- lock-down applied in 20260622140000.

CREATE OR REPLACE FUNCTION public.match_ai_memories_v2(
    p_business_id     uuid,
    p_actor_kind      text,
    p_actor_key       text,
    p_query_embedding vector,
    p_match_threshold double precision DEFAULT 0.78,
    p_match_count     integer DEFAULT 5
)
RETURNS TABLE(
    id         uuid,
    content    text,
    kind       text,
    metadata   jsonb,
    similarity double precision,
    created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- `extensions` is required so the pgvector `<=>` operator resolves: pgvector
-- lives in `public` on the production project but in `extensions` on a stock
-- local stack, and the body is validated against this search_path at CREATE time.
SET search_path TO 'public', 'extensions'
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

-- Agent-only: never callable from a browser session.
REVOKE ALL ON FUNCTION public.match_ai_memories_v2(uuid, text, text, vector, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ai_memories_v2(uuid, text, text, vector, double precision, integer) TO service_role;
