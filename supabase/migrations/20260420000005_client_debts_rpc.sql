CREATE OR REPLACE FUNCTION get_clients_debts(p_business_id UUID)
RETURNS TABLE (client_id UUID, total_debt numeric)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH apt_costs AS (
    SELECT 
      a.client_id,
      COALESCE(SUM(s.price), 0) as expected_revenue
    FROM appointments a
    JOIN appointment_services aps ON aps.appointment_id = a.id
    JOIN services s ON s.id = aps.service_id
    WHERE a.business_id = p_business_id
      AND a.status NOT IN ('cancelled', 'no_show')
      AND a.start_at < now()
    GROUP BY a.client_id
  ),
  apt_payments AS (
    SELECT 
      a.client_id,
      COALESCE(SUM(t.net_amount), 0) as actually_paid
    FROM appointments a
    JOIN transactions t ON t.appointment_id = a.id
    WHERE a.business_id = p_business_id
      AND a.status NOT IN ('cancelled', 'no_show')
      AND a.start_at < now()
    GROUP BY a.client_id
  )
  SELECT 
    c.client_id,
    (c.expected_revenue - COALESCE(p.actually_paid, 0)) as total_debt
  FROM apt_costs c
  LEFT JOIN apt_payments p ON p.client_id = c.client_id
  WHERE (c.expected_revenue - COALESCE(p.actually_paid, 0)) > 0;
END;
$$;
