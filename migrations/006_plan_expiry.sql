-- Warr.GG — 006: plan auto-expiry + service-role compatibility
-- 1) plan_expires_at: when set, paid plans lapse automatically — the server
--    proxy and clients treat an expired plan as 'free' with no cron needed.
-- 2) The protect-plan trigger (004) must also guard the expiry column, and
--    must ALLOW service-role writes (auth.jwt() is null for service role,
--    which 004 wrongly treated as a non-admin).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_plan_column()
RETURNS trigger AS $$
DECLARE
  jwt_email text := COALESCE(auth.jwt()->>'email','');
  jwt_role  text := COALESCE(auth.jwt()->>'role', current_setting('request.jwt.claim.role', true), '');
BEGIN
  -- service_role (no user JWT) and the admin may change plan fields
  IF jwt_email = 'wrrenvillapando@gmail.com' OR jwt_role = 'service_role' OR auth.jwt() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    NEW.plan := OLD.plan;
  END IF;
  IF NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN
    NEW.plan_expires_at := OLD.plan_expires_at;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_plan ON public.profiles;
CREATE TRIGGER trg_protect_plan
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_plan_column();
