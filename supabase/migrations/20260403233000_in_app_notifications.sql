-- 20260403233000_in_app_notifications.sql
-- Create a table for real-time internal notifications (In-App Dashboard)

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- Target a specific user if needed
  title text NOT NULL,
  content text NOT NULL,
  type text CHECK (type IN ('info', 'success', 'warning', 'error')) DEFAULT 'info',
  is_read boolean DEFAULT false,
  metadata jsonb DEFAULT '{}', -- Store appointment_id, client_id, etc.
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Indexing for performance
CREATE INDEX idx_notifications_business_id ON public.notifications (business_id);
CREATE INDEX idx_notifications_is_read ON public.notifications (is_read) WHERE is_read = false;

-- RLS Policies
CREATE POLICY "Users can view notifications for their business"
  ON public.notifications FOR SELECT
  USING (business_id = (SELECT business_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can mark their business notifications as read"
  ON public.notifications FOR UPDATE
  USING (business_id = (SELECT business_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (is_read = true); -- Only allow changing is_read to true

-- Helper Function to Mark All as Read (Convenience)
CREATE OR REPLACE FUNCTION public.fn_mark_all_notifications_as_read(target_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Double check the business access through the users table for security
  IF EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND business_id = target_business_id) THEN
    UPDATE public.notifications
    SET is_read = true
    WHERE business_id = target_business_id AND is_read = false;
  END IF;
END;
$$;
