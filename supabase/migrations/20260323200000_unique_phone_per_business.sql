-- ─────────────────────────────────────────────────────────────────────────────
-- Unique phone number per business (active clients only)
--
-- Rules:
--   • NULL phones are excluded — a client without phone is always allowed
--   • Soft-deleted clients (deleted_at IS NOT NULL) are excluded — their
--     phone can be reused if a new client is created with the same number
--   • Two DIFFERENT businesses can share the same phone (client may attend
--     more than one business)
-- ─────────────────────────────────────────────────────────────────────────────

-- Clean up any existing duplicates before adding the constraint.
-- Keep the oldest row (smallest created_at) and soft-delete the rest.
UPDATE public.clients a
SET deleted_at = NOW()
FROM public.clients b
WHERE a.business_id = b.business_id
  AND a.phone        = b.phone
  AND a.phone       IS NOT NULL
  AND a.deleted_at  IS NULL
  AND b.deleted_at  IS NULL
  AND a.created_at   > b.created_at;

-- Partial unique index: phone must be unique within a business for active clients.
CREATE UNIQUE INDEX clients_business_phone_unique
  ON public.clients (business_id, phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;
