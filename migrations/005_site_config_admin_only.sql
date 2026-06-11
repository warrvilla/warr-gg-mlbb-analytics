-- Warr.GG — 005: lock site_config to the admin account
-- The legacy AI-key flow stored an obfuscated key in site_config readable
-- by any signed-in browser (that's how keys leak). After this migration,
-- ONLY the admin can read or write site_config rows. Regular users get
-- their AI through the server proxy (Netlify env var), which never
-- touches this table.

ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_config_public_read" ON public.site_config;
DROP POLICY IF EXISTS "site_config_read"        ON public.site_config;
DROP POLICY IF EXISTS "site_config_write"       ON public.site_config;
DROP POLICY IF EXISTS "site_config_admin_only"  ON public.site_config;

CREATE POLICY "site_config_admin_only" ON public.site_config
  FOR ALL
  USING     (COALESCE(auth.jwt()->>'email','') = 'wrrenvillapando@gmail.com')
  WITH CHECK(COALESCE(auth.jwt()->>'email','') = 'wrrenvillapando@gmail.com');
