-- 021_locked_teams.sql
-- Lock a team's PROFILE/DATA from public view. A locked team still appears in
-- lists, but its scout report, analysis, and matchups are masked ("🔒 Locked")
-- for everyone except the admin (owner) and the emails the admin shares it with.
-- Only the admin may lock/unlock a team or manage who it's shared with.
--
-- Note: this is a view-lock. The team's match rows still exist (that's what keeps
-- the team showing in lists); for fully-invisible data, log it under a Private
-- league (migration 017) instead.
--
-- Run in Supabase → SQL Editor.

-- 1) Which teams are locked.
CREATE TABLE IF NOT EXISTS public.locked_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name  text NOT NULL,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (team_name)
);
ALTER TABLE public.locked_teams ENABLE ROW LEVEL SECURITY;

-- Everyone may read the lock LIST (so the app knows which teams to mask).
-- Knowing a team is locked isn't sensitive; the team's data is what's gated.
DROP POLICY IF EXISTS "locked_teams_select" ON public.locked_teams;
CREATE POLICY "locked_teams_select" ON public.locked_teams FOR SELECT USING (true);

-- Only the admin may lock / unlock teams.
DROP POLICY IF EXISTS "locked_teams_write" ON public.locked_teams;
CREATE POLICY "locked_teams_write" ON public.locked_teams FOR ALL
  USING ( (auth.jwt()->>'email') = 'wrrenvillapando@gmail.com' )
  WITH CHECK ( (auth.jwt()->>'email') = 'wrrenvillapando@gmail.com' );

-- 2) Who a locked team is shared with (by email).
CREATE TABLE IF NOT EXISTS public.locked_team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name  text NOT NULL,
  email      text NOT NULL,
  added_by   uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (team_name, email)
);
ALTER TABLE public.locked_team_members ENABLE ROW LEVEL SECURITY;

-- Read a membership row if it's your own email or you're the admin.
DROP POLICY IF EXISTS "locked_team_members_select" ON public.locked_team_members;
CREATE POLICY "locked_team_members_select" ON public.locked_team_members FOR SELECT USING (
  lower(email) = lower(auth.jwt()->>'email')
  OR (auth.jwt()->>'email') = 'wrrenvillapando@gmail.com'
);
-- Only the admin may add / remove shared emails.
DROP POLICY IF EXISTS "locked_team_members_write" ON public.locked_team_members;
CREATE POLICY "locked_team_members_write" ON public.locked_team_members FOR ALL
  USING ( (auth.jwt()->>'email') = 'wrrenvillapando@gmail.com' )
  WITH CHECK ( (auth.jwt()->>'email') = 'wrrenvillapando@gmail.com' );

NOTIFY pgrst, 'reload schema';
