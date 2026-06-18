-- 20260618140000_backfill_working_hours.sql
--
-- Existing businesses created via the email-signup path (auth/callback
-- ensureBusinessFromMetadata) never went through /setup, so settings.workingHours
-- was never seeded. With a null schedule the WhatsApp/voice agents assume every
-- day incl. Sunday is open 09:00–18:00 and can offer/accept out-of-hours slots.
--
-- Backfill a safe, explicit default (Mon–Sat 09:00–18:00, Sun closed) in the
-- dashboard's canonical shape. workingHoursConfirmed = false marks it as a system
-- default (not owner-chosen) so the dashboard nudges the owner to confirm their
-- real schedule. Only touches businesses whose workingHours is absent/null/empty —
-- never clobbers a configured schedule.

UPDATE public.businesses
SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
  'workingHours', jsonb_build_object(
    'mon', jsonb_build_array('09:00', '18:00'),
    'tue', jsonb_build_array('09:00', '18:00'),
    'wed', jsonb_build_array('09:00', '18:00'),
    'thu', jsonb_build_array('09:00', '18:00'),
    'fri', jsonb_build_array('09:00', '18:00'),
    'sat', jsonb_build_array('09:00', '18:00'),
    'sun', NULL
  ),
  'workingHoursConfirmed', false
)
WHERE NOT (settings ? 'workingHours')
   OR settings->'workingHours' IS NULL
   OR settings->'workingHours' = 'null'::jsonb
   OR settings->'workingHours' = '{}'::jsonb;
