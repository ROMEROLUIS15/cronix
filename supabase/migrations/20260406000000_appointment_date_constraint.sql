-- Reject appointments scheduled more than 365 days in the future.
-- Validates at INSERT and when start_at changes (but not on other field updates).
-- Prevents year 3000 exploits and obviously invalid future dates.

CREATE OR REPLACE FUNCTION fn_validate_appointment_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Only validate when start_at is inserted or changed
  IF TG_OP = 'INSERT' OR NEW.start_at IS DISTINCT FROM OLD.start_at THEN
    IF NEW.start_at > NOW() + INTERVAL '365 days' THEN
      RAISE EXCEPTION 'INVALID_DATE: appointment cannot be scheduled more than 365 days in the future';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_validate_appointment_date ON appointments;
CREATE TRIGGER trg_validate_appointment_date
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_validate_appointment_date();
