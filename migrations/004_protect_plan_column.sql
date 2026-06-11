-- Warr.GG — 004: protect profiles.plan from self-upgrades
-- RLS lets users UPDATE their own profile row (display name, hero pool...).
-- Without this trigger they could also set plan='pro' via the REST API and
-- get paid AI limits for free. The trigger silently reverts plan changes
-- made by anyone who isn't the admin.

CREATE OR REPLACE FUNCTION public.protect_plan_column()
RETURNS trigger AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan
     AND COALESCE(auth.jwt()->>'email','') <> 'wrrenvillapando@gmail.com' THEN
    NEW.plan := OLD.plan;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_plan ON public.profiles;
CREATE TRIGGER trg_protect_plan
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_plan_column();
