-- Finds a client by normalized phone digits.
-- WhatsApp sends bare digits (e.g. "584247092980") but clients.phone stores
-- formatted numbers (e.g. "+58 4247092980" or "+58 04247092980").
-- This function strips non-digits from both sides and also handles the
-- leading-zero variant common in Venezuelan numbers (0424 vs 424).

CREATE OR REPLACE FUNCTION public.fn_find_client_by_phone(
  p_business_id  uuid,
  p_phone_digits text
)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_alt text;
BEGIN
  -- Try exact digits match first
  RETURN QUERY
  SELECT c.id, c.name
  FROM public.clients c
  WHERE c.business_id = p_business_id
    AND c.deleted_at IS NULL
    AND public.fn_clean_phone(c.phone) = p_phone_digits
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Try with leading zero after country code (58 0424... vs 58 424...)
  -- Insert a 0 after the first 2 digits of the input
  v_alt := left(p_phone_digits, 2) || '0' || substring(p_phone_digits from 3);

  RETURN QUERY
  SELECT c.id, c.name
  FROM public.clients c
  WHERE c.business_id = p_business_id
    AND c.deleted_at IS NULL
    AND public.fn_clean_phone(c.phone) = v_alt
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- Try removing a leading zero after country code from stored phone
  -- (stored: 5804247092980, input: 584247092980)
  RETURN QUERY
  SELECT c.id, c.name
  FROM public.clients c
  WHERE c.business_id = p_business_id
    AND c.deleted_at IS NULL
    AND regexp_replace(public.fn_clean_phone(c.phone), '^(\d{2})0', '\1') = p_phone_digits
  LIMIT 1;
END;
$$;
