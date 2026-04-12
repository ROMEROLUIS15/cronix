-- 20260412000001_phone_normalization.sql
-- FASE 1: Eliminate full table scans on phone lookups.
-- 1. Add phone_digits GENERATED column to clients (auto-normalized)
-- 2. Add phone_digits GENERATED column to businesses
-- 3. Create B-tree indexes for O(1) lookups
-- 4. Rewrite fn_find_client_by_phone to use indexes

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. clients.phone_digits — GENERATED ALWAYS AS STORED
-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-normalized: strips all non-digits, stores only numbers.
-- Populated automatically on INSERT/UPDATE — zero application logic needed.

ALTER TABLE public.clients
    ADD COLUMN phone_digits text GENERATED ALWAYS AS (
        regexp_replace(phone, '[^0-9]', '', 'g')
    ) STORED;

-- Partial unique index: active clients only, unique per business
-- Replaces the old partial unique index on phone (which couldn't be used by fn_clean_phone)
-- First, drop the old one if it exists
DROP INDEX IF EXISTS clients_business_phone_unique;

CREATE UNIQUE INDEX idx_clients_business_phone_digits
    ON public.clients (business_id, phone_digits)
    WHERE phone_digits IS NOT NULL AND deleted_at IS NULL;

-- Standalone B-tree index for fast phone lookups
CREATE INDEX IF NOT EXISTS idx_clients_phone_digits
    ON public.clients (phone_digits)
    WHERE phone_digits IS NOT NULL AND deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. businesses.phone_digits — GENERATED ALWAYS AS STORED
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.businesses
    ADD COLUMN phone_digits text GENERATED ALWAYS AS (
        regexp_replace(phone, '[^0-9]', '', 'g')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_businesses_phone_digits
    ON public.businesses (phone_digits)
    WHERE phone_digits IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REWRITE: fn_find_client_by_phone — Use phone_digits index
-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE: 3 sequential full-scans applying fn_clean_phone() on column side
-- AFTER:  Single index seek on phone_digits + one variant query with leading zero

CREATE OR REPLACE FUNCTION public.fn_find_client_by_phone(
    p_business_id uuid,
    p_phone text
)
RETURNS TABLE (
    client_id uuid,
    client_name text,
    client_email text,
    client_phone text,
    client_avatar_url text,
    match_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    v_digits text;
BEGIN
    -- Normalize input once
    v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');

    -- Match 1: Exact digits match (uses idx_clients_phone_digits)
    RETURN QUERY
    SELECT c.id, c.name, c.email, c.phone, c.avatar_url, 'exact'::text
    FROM public.clients c
    WHERE c.business_id = p_business_id
      AND c.phone_digits = v_digits
      AND c.deleted_at IS NULL
    LIMIT 1;

    -- If no exact match, try Venezuelan variants
    IF FOUND THEN RETURN; END IF;

    -- Match 2: Input with leading zero (e.g., user sends "0412..." but DB has "412...")
    IF length(v_digits) >= 3 AND substr(v_digits, 1, 1) = '0' THEN
        RETURN QUERY
        SELECT c.id, c.name, c.email, c.phone, c.avatar_url, 'leading_zero_strip'::text
        FROM public.clients c
        WHERE c.business_id = p_business_id
          AND c.phone_digits = regexp_replace(v_digits, '^0', '')
          AND c.deleted_at IS NULL
        LIMIT 1;
    END IF;

    -- Match 3: Input without leading zero, try with leading zero
    IF length(v_digits) >= 2 AND substr(v_digits, 1, 1) != '0' THEN
        RETURN QUERY
        SELECT c.id, c.name, c.email, c.phone, c.avatar_url, 'leading_zero_add'::text
        FROM public.clients c
        WHERE c.business_id = p_business_id
          AND c.phone_digits = '0' || v_digits
          AND c.deleted_at IS NULL
        LIMIT 1;
    END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REWRITE: fn_get_business_by_phone — Use phone_digits index
-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE: full table scan applying fn_clean_phone() to every row
-- AFTER:  index seek on phone_digits

CREATE OR REPLACE FUNCTION public.fn_get_business_by_phone(p_wa_phone_id text)
RETURNS TABLE (id uuid, name text, timezone text, settings jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
    SELECT b.id, b.name, b.timezone, b.settings
    FROM public.businesses b
    WHERE b.phone_digits = regexp_replace(p_wa_phone_id, '[^0-9]', '', 'g')
       OR (b.settings->>'wa_phone_number_id') = p_wa_phone_id
    LIMIT 1;
$$;
