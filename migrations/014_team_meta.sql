-- Warr.GG — 014: Team profile metadata (cloud-synced)
-- Admin-set fields that can't be derived from match data: regular-season rank,
-- playoff placement, social/redirect link, win condition, coach notes.
-- Public read (everyone sees the profiles); only the admin can write (RLS).

CREATE TABLE IF NOT EXISTS public.team_meta (
  team_name     text PRIMARY KEY,
  rs_rank       int,
  placement     text,
  link          text,
  win_condition text,
  coach_notes   text,
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE public.team_meta ENABLE ROW LEVEL SECURITY;

-- Anyone (even anon) can read team profiles.
DROP POLICY IF EXISTS "team_meta read" ON public.team_meta;
CREATE POLICY "team_meta read" ON public.team_meta
  FOR SELECT USING (true);

-- Only the admin email may insert/update/delete.
DROP POLICY IF EXISTS "team_meta admin write" ON public.team_meta;
CREATE POLICY "team_meta admin write" ON public.team_meta
  FOR ALL
  USING ( (auth.jwt() ->> 'email') = 'wrrenvillapando@gmail.com' )
  WITH CHECK ( (auth.jwt() ->> 'email') = 'wrrenvillapando@gmail.com' );
