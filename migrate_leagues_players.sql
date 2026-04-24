-- ─────────────────────────────────────────────────────────────────
-- Warr.GG — Create `leagues`, `seasons`, `players` tables
-- Run this in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: everything uses IF NOT EXISTS / OR REPLACE / IF EXISTS.
-- ─────────────────────────────────────────────────────────────────

-- ── updated_at trigger function (needed by players table) ─────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── LEAGUES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leagues (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text NOT NULL UNIQUE,
  region          text,
  is_scout_active boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id)
);

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leagues_public_read"  ON public.leagues;
DROP POLICY IF EXISTS "leagues_auth_write"   ON public.leagues;
DROP POLICY IF EXISTS "leagues_auth_update"  ON public.leagues;
DROP POLICY IF EXISTS "leagues_auth_delete"  ON public.leagues;
CREATE POLICY "leagues_public_read"  ON public.leagues FOR SELECT USING (true);
CREATE POLICY "leagues_auth_write"   ON public.leagues FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "leagues_auth_update"  ON public.leagues FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "leagues_auth_delete"  ON public.leagues FOR DELETE USING (auth.role() = 'authenticated');

-- ── SEASONS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seasons (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  league_id       uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  name            text NOT NULL,
  split           text,
  start_date      date,
  end_date        date,
  is_active       boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seasons_league_idx ON public.seasons(league_id);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seasons_public_read"  ON public.seasons;
DROP POLICY IF EXISTS "seasons_auth_write"   ON public.seasons;
DROP POLICY IF EXISTS "seasons_auth_update"  ON public.seasons;
DROP POLICY IF EXISTS "seasons_auth_delete"  ON public.seasons;
CREATE POLICY "seasons_public_read"  ON public.seasons FOR SELECT USING (true);
CREATE POLICY "seasons_auth_write"   ON public.seasons FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "seasons_auth_update"  ON public.seasons FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "seasons_auth_delete"  ON public.seasons FOR DELETE USING (auth.role() = 'authenticated');

-- ── PLAYERS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.players (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ign             text NOT NULL,
  real_name       text,
  team_name       text NOT NULL,
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS players_team_name_idx ON public.players(team_name);
CREATE INDEX IF NOT EXISTS players_ign_idx        ON public.players(ign);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "players_public_read"   ON public.players;
DROP POLICY IF EXISTS "players_auth_insert"   ON public.players;
DROP POLICY IF EXISTS "players_own_update"    ON public.players;
DROP POLICY IF EXISTS "players_own_delete"    ON public.players;
CREATE POLICY "players_public_read"   ON public.players FOR SELECT USING (true);
CREATE POLICY "players_auth_insert"   ON public.players FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "players_own_update"    ON public.players FOR UPDATE USING (
  created_by = auth.uid() OR auth.email() = 'wrrenvillapando@gmail.com'
);
CREATE POLICY "players_own_delete"    ON public.players FOR DELETE USING (
  created_by = auth.uid() OR auth.email() = 'wrrenvillapando@gmail.com'
);

DROP TRIGGER IF EXISTS players_updated_at ON public.players;
CREATE TRIGGER players_updated_at
  BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ── Tell PostgREST to reload the schema cache ─────────────────────
-- Without this, the API may still return "schema cache" errors for a minute.
NOTIFY pgrst, 'reload schema';

-- ── Verify ────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.leagues) AS leagues_rows,
  (SELECT count(*) FROM public.seasons) AS seasons_rows,
  (SELECT count(*) FROM public.players) AS players_rows;
