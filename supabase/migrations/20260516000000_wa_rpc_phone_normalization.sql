-- ─────────────────────────────────────────────────────────────────────────────
-- Make WhatsApp client-upsert RPC robust to the phone uniqueness index swap.
--
-- Background:
--   Migration 20260412000001 added clients.phone_digits (GENERATED) and a
--   partial unique index on (business_id, phone_digits), and dropped the old
--   `clients_business_phone_unique` on raw (business_id, phone).
--
--   `fn_book_appointment_wa` (last rewritten in 20260402235900) does:
--       INSERT INTO public.clients (...) VALUES (...)
--       ON CONFLICT (business_id, phone) DO UPDATE SET ...
--
--   `ON CONFLICT (col_list)` requires an exact-column-match unique constraint
--   on those columns. Once 20260412 + 20260515 have applied, no such index
--   exists on raw `phone`, and the RPC raises:
--       "there is no unique or exclusion constraint matching the
--        ON CONFLICT specification"
--
--   WhatsApp bookings would silently fail. This migration rewrites the
--   function to a SELECT-then-INSERT-with-unique_violation-catch pattern,
--   keyed on the normalised phone_digits column (which now has the index).
--   Behaviour is unchanged for callers: same args, same return shape, same
--   side effects.
--
-- Note on regression risk:
--   Migration 20260331010000 had this function ALSO inserting into the
--   appointment_services junction. The 20260402235900 "restore" lost that.
--   We preserve the 20260402 behaviour verbatim here (no junction insert) to
--   avoid scope-creeping a separate concern. The junction backfill in
--   20260331010000 remains the source of truth for that data parity.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_book_appointment_wa(
    p_business_id  uuid,
    p_client_phone text,
    p_client_name  text,
    p_service_id   uuid,
    p_start_at     timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_client_id      uuid;
    v_clean_phone    text;
    v_duration       int;
    v_end_at         timestamptz;
    v_appointment_id uuid;
BEGIN
    v_clean_phone := public.fn_clean_phone(p_client_phone);

    -- Resolve service duration (default to 30 if unknown).
    SELECT duration_min INTO v_duration
    FROM public.services WHERE id = p_service_id;
    v_duration := COALESCE(v_duration, 30);
    v_end_at   := p_start_at + (v_duration || ' minutes')::interval;

    -- Existing client by normalised phone (uses idx_clients_business_phone_digits).
    SELECT id INTO v_client_id
    FROM public.clients
    WHERE business_id  = p_business_id
      AND phone_digits = v_clean_phone
      AND deleted_at  IS NULL
    LIMIT 1;

    IF v_client_id IS NULL THEN
        -- Try to create. The partial unique index will reject a concurrent
        -- duplicate; in that case re-query and update the existing row.
        BEGIN
            INSERT INTO public.clients (business_id, name, phone)
            VALUES (p_business_id, p_client_name, v_clean_phone)
            RETURNING id INTO v_client_id;
        EXCEPTION WHEN unique_violation THEN
            SELECT id INTO v_client_id
            FROM public.clients
            WHERE business_id  = p_business_id
              AND phone_digits = v_clean_phone
              AND deleted_at  IS NULL
            LIMIT 1;
            IF v_client_id IS NOT NULL THEN
                UPDATE public.clients
                SET name = p_client_name, updated_at = now()
                WHERE id = v_client_id;
            END IF;
        END;
    ELSE
        UPDATE public.clients
        SET name = p_client_name, updated_at = now()
        WHERE id = v_client_id;
    END IF;

    -- Business-wide overlap check (correct for WhatsApp — no employee scope).
    IF EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.business_id = p_business_id
          AND a.status NOT IN ('cancelled', 'no_show')
          AND (a.start_at < v_end_at)
          AND (a.end_at   > p_start_at)
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Slot no disponible.');
    END IF;

    INSERT INTO public.appointments (
        business_id, client_id, service_id, start_at, end_at, status, notes
    ) VALUES (
        p_business_id, v_client_id, p_service_id, p_start_at, v_end_at,
        'confirmed', 'Agendado vía WhatsApp AI'
    )
    RETURNING id INTO v_appointment_id;

    RETURN jsonb_build_object(
        'success',        true,
        'appointment_id', v_appointment_id
    );
END;
$$;
COMMENT ON FUNCTION public.fn_book_appointment_wa IS
  'WhatsApp booking RPC. Upserts client by normalised phone (phone_digits) and creates an auto-confirmed appointment if the slot is free. Robust to the (business_id, phone) → (business_id, phone_digits) index swap done in 20260412000001 / 20260515120000.';
