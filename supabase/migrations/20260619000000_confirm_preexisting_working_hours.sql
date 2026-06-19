-- 20260619000000_confirm_preexisting_working_hours.sql
--
-- BUG: the dashboard "confirm your schedule" nudge (WorkingHoursBanner) was shown
-- to businesses that ALREADY had a real, owner-set schedule. The earlier backfill
-- (20260618140000) only set workingHoursConfirmed=false on businesses it DEFAULTED
-- (those missing workingHours). Businesses configured BEFORE the flag existed kept
-- workingHoursConfirmed absent → the banner treats absent as "not confirmed" → nags
-- them even though their hours are real.
--
-- FIX: a business that already has a non-empty workingHours and no explicit
-- workingHoursConfirmed flag was configured by its owner before the flag existed →
-- mark it confirmed. The defaulted businesses (flag = false) are intentionally left
-- so they keep being nudged to confirm their real schedule.

UPDATE public.businesses
SET settings = jsonb_set(settings, '{workingHoursConfirmed}', 'true'::jsonb)
WHERE settings ? 'workingHours'
  AND settings->'workingHours' <> '{}'::jsonb
  AND NOT (settings ? 'workingHoursConfirmed');
