-- Pin search_path on the functions flagged by the security advisor ("Function Search
-- Path Mutable"). Without an explicit search_path a function inherits the role default,
-- which is mutable and a search_path-injection surface (especially for SECURITY DEFINER,
-- e.g. get_clients_debts). `public, extensions, pg_temp` is a safe superset of what these
-- functions reference (incl. the `vector` type used by match_memories), so behaviour is
-- unchanged; pg_temp is placed last. pg_catalog is always searched implicitly.

ALTER FUNCTION public.get_clients_debts(p_business_id uuid)
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.fn_validate_appointment_date()
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.match_memories(query_embedding vector, match_threshold double precision, match_count integer, p_user_id uuid, p_business_id uuid)
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.fn_batch_create_transactions(p_business_id uuid, p_transactions jsonb)
  SET search_path = public, extensions, pg_temp;
