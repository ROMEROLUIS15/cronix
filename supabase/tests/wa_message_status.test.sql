-- ─────────────────────────────────────────────────────────────────────────────
-- pgTAP Tests: WhatsApp delivery state (wa_message_status, fn_record_wa_status)
-- Run via: supabase test db
--
-- Meta's status events do not arrive in a fixed order, and one can arrive before
-- whatsapp-service stores the accepted message. The state only moves forward.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SELECT plan(15);

-- 1. Objects and access: only the service role reads or writes.
SELECT has_table('public', 'wa_message_status', 'wa_message_status exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.wa_message_status'::regclass), true, 'RLS is on');
SELECT ok(NOT has_table_privilege('authenticated', 'public.wa_message_status', 'SELECT'), 'authenticated cannot read it');
SELECT ok(NOT has_table_privilege('anon', 'public.wa_message_status', 'SELECT'), 'anon cannot read it');
SELECT ok(NOT has_function_privilege('authenticated', 'public.fn_record_wa_status(text,text,integer,text,timestamptz)', 'EXECUTE'), 'authenticated cannot record a status');
SELECT ok(has_function_privilege('service_role', 'public.fn_record_wa_status(text,text,integer,text,timestamptz)', 'EXECUTE'), 'service_role can record a status');

-- 2. Forward only: sent → delivered → read; a late 'sent' or 'delivered' changes nothing.
INSERT INTO public.wa_message_status (wamid, accepted_at) VALUES ('w-forward', now());
SELECT public.fn_record_wa_status('w-forward', 'sent', NULL, NULL, now());
SELECT public.fn_record_wa_status('w-forward', 'read', NULL, NULL, now());
SELECT public.fn_record_wa_status('w-forward', 'delivered', NULL, NULL, now());
SELECT public.fn_record_wa_status('w-forward', 'sent', NULL, NULL, now());
SELECT is((SELECT status FROM public.wa_message_status WHERE wamid = 'w-forward'), 'read', 'read is not overwritten by a late delivered or sent');

-- 3. A failure replaces accepted/sent and keeps Meta's code and title.
INSERT INTO public.wa_message_status (wamid, accepted_at) VALUES ('w-fail', now());
SELECT public.fn_record_wa_status('w-fail', 'sent', NULL, NULL, now());
SELECT public.fn_record_wa_status('w-fail', 'failed', 131049, 'healthy ecosystem engagement', now());
SELECT is((SELECT status FROM public.wa_message_status WHERE wamid = 'w-fail'), 'failed', 'failed replaces sent');
SELECT is((SELECT error_code FROM public.wa_message_status WHERE wamid = 'w-fail'), 131049, 'the Meta error code is kept');
SELECT public.fn_record_wa_status('w-fail', 'delivered', NULL, NULL, now());
SELECT is((SELECT error_code FROM public.wa_message_status WHERE wamid = 'w-fail'), NULL, 'a later delivery clears the error');

-- 4. A failure never replaces a delivery.
INSERT INTO public.wa_message_status (wamid, accepted_at) VALUES ('w-delivered', now());
SELECT public.fn_record_wa_status('w-delivered', 'delivered', NULL, NULL, now());
SELECT public.fn_record_wa_status('w-delivered', 'failed', 131026, 'undeliverable', now());
SELECT is((SELECT status FROM public.wa_message_status WHERE wamid = 'w-delivered'), 'delivered', 'failed does not replace delivered');

-- 5. Status first, owner later: whatsapp-service's upsert keeps the status it finds.
SELECT public.fn_record_wa_status('w-early', 'delivered', NULL, NULL, now());
SELECT is((SELECT status FROM public.wa_message_status WHERE wamid = 'w-early'), 'delivered', 'a status that arrives first creates the row');
INSERT INTO public.wa_message_status (wamid, purpose, template, accepted_at)
  VALUES ('w-early', 'client_reminder', 'appointment_reminder', now())
  ON CONFLICT (wamid) DO UPDATE SET purpose = excluded.purpose, template = excluded.template, accepted_at = excluded.accepted_at;
SELECT is((SELECT status FROM public.wa_message_status WHERE wamid = 'w-early'), 'delivered', 'storing the owner afterwards keeps the status');
SELECT is((SELECT purpose FROM public.wa_message_status WHERE wamid = 'w-early'), 'client_reminder', 'and fills in who it belongs to');

-- 6. Unknown values are refused by the table.
SELECT throws_ok($$ INSERT INTO public.wa_message_status (wamid, status) VALUES ('w-bad', 'deleted') $$, '23514', NULL, 'an unknown status is refused');

SELECT * FROM finish();

ROLLBACK;
