-- 018_team_season_rosters.sql
-- Explicit per-season rosters: each team has a saved roster per season, so
-- transfers/subs across seasons are tracked precisely (independent of match data).
-- Run in Supabase → SQL Editor.

CREATE TABLE IF NOT EXISTS public.team_rosters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name   text NOT NULL,
  season      text NOT NULL,
  ign         text NOT NULL,
  real_name   text,
  role        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (team_name, season, ign)
);

ALTER TABLE public.team_rosters ENABLE ROW LEVEL SECURITY;

-- Rosters are reference data — readable by everyone.
DROP POLICY IF EXISTS "team_rosters_select" ON public.team_rosters;
CREATE POLICY "team_rosters_select" ON public.team_rosters FOR SELECT USING (true);

-- Only the admin (or the row's creator) may add / edit / remove roster entries.
DROP POLICY IF EXISTS "team_rosters_write" ON public.team_rosters;
CREATE POLICY "team_rosters_write" ON public.team_rosters FOR ALL
  USING ( created_by = auth.uid() OR (auth.jwt()->>'email') = 'wrrenvillapando@gmail.com' )
  WITH CHECK ( created_by = auth.uid() OR (auth.jwt()->>'email') = 'wrrenvillapando@gmail.com' );

NOTIFY pgrst, 'reload schema';
