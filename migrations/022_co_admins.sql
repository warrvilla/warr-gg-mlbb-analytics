-- 022_co_admins.sql
-- Limited co-admins: emails in the site_config "extra_admins" list can add
-- leagues and add/edit official match data (+ team rosters) — the same data
-- powers as the primary admin. They CANNOT manage the admin list or lock/unlock
-- teams; those stay primary-admin-only (wrrenvillapando@gmail.com).
--
-- Run in Supabase → SQL Editor.  Depends on: site_config table (extra_admins),
-- migration 015 (match write policies), 018 (team_rosters), 020 (match select).

-- ── Helper: is the current user any admin (primary OR a listed co-admin)? ─────
-- SECURITY DEFINER so it can read site_config even when that table's own RLS
-- would block a co-admin from reading it directly.
CREATE OR REPLACE FUNCTION public.is_warr_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lower(coalesce(auth.jwt()->>'email','')) = 'wrrenvillapando@gmail.com'
    OR EXISTS (
      SELECT 1 FROM public.site_config sc
      WHERE sc.key = 'extra_admins'
        AND (sc.value)::jsonb ? lower(coalesce(auth.jwt()->>'email',''))
    );
$$;

-- ── Match data: official-league writes allowed for ANY admin ─────────────────
DROP POLICY IF EXISTS "scout_matches_insert" ON public.scout_matches;
CREATE POLICY "scout_matches_insert"
  ON public.scout_matches
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (
      COALESCE(data->>'league','') IN ('Scrims','Other','AI Battle')  -- anyone logs their own private data
      OR public.is_warr_admin()                                       -- any admin writes official leagues
    )
  );

DROP POLICY IF EXISTS "scout_matches_update" ON public.scout_matches;
CREATE POLICY "scout_matches_update"
  ON public.scout_matches
  FOR UPDATE
  USING ( created_by = auth.uid() OR public.is_warr_admin() )
  WITH CHECK ( created_by = auth.uid() OR public.is_warr_admin() );

DROP POLICY IF EXISTS "scout_matches_delete" ON public.scout_matches;
CREATE POLICY "scout_matches_delete"
  ON public.scout_matches
  FOR DELETE
  USING ( created_by = auth.uid() OR public.is_warr_admin() );

-- ── Leagues: any admin may add / edit / remove leagues ──────────────────────
-- Added as a permissive policy that ORs with any existing primary-admin policy.
-- (Assumes RLS is already enabled on public.leagues, which it is since league
--  writes are currently restricted to the primary admin.)
DROP POLICY IF EXISTS "leagues_admin_write" ON public.leagues;
CREATE POLICY "leagues_admin_write" ON public.leagues FOR ALL
  USING ( public.is_warr_admin() )
  WITH CHECK ( public.is_warr_admin() );

-- ── Team rosters: any admin may manage (plus the row's own creator) ─────────
DROP POLICY IF EXISTS "team_rosters_write" ON public.team_rosters;
CREATE POLICY "team_rosters_write" ON public.team_rosters FOR ALL
  USING ( created_by = auth.uid() OR public.is_warr_admin() )
  WITH CHECK ( created_by = auth.uid() OR public.is_warr_admin() );

-- NOTE: locked_teams / locked_team_members (021) and site_config admin writes
-- are deliberately left primary-admin-only, so only you can lock teams or
-- add/remove admins.

NOTIFY pgrst, 'reload schema';
