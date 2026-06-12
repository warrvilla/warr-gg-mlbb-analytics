-- Warr.GG — 010: complimentary (free-comp) account flag
-- Lets the admin grant Pro/Team access WITHOUT it counting as paid revenue.
-- MRR and "paying users" exclude comped accounts; a separate "Comped" stat
-- tracks them. Guarded by the same plan-protect trigger (only admin/service
-- role can change it).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_comp boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.protect_plan_column()
RETURNS trigger AS $$
DECLARE
  jwt_email text := COALESCE(auth.jwt()->>'email','');
  jwt_role  text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF jwt_email = 'wrrenvillapando@gmail.com' OR jwt_role = 'service_role' OR auth.jwt() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN NEW.plan := OLD.plan; END IF;
  IF NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN NEW.plan_expires_at := OLD.plan_expires_at; END IF;
  IF NEW.is_comp IS DISTINCT FROM OLD.is_comp THEN NEW.is_comp := OLD.is_comp; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
