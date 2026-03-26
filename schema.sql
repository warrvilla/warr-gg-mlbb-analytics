-- ═══════════════════════════════════════════════════════════════
-- WARR.GG — Supabase Database Schema
-- Run this in your Supabase project SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── TEAMS ─────────────────────────────────────────────────────
-- Linked 1:1 to auth.users. Created on registration.
CREATE TABLE IF NOT EXISTS public.teams (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  team_name    text NOT NULL UNIQUE,
  region       text,
  win_condition text,
  coach_notes  text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- ── HEROES ────────────────────────────────────────────────────
-- Public hero roster (readable by everyone, managed by admin)
CREATE TABLE IF NOT EXISTS public.heroes (
  id         text PRIMARY KEY,         -- e.g. 'grock', 'chou'
  name       text NOT NULL,
  role       text,                     -- 'Tank', 'Fighter', 'Mage', etc.
  tier       text DEFAULT 'B',         -- S, A, B, C, D
  mp         text DEFAULT 'situational', -- mustban | highpick | situational | off | troll
  color      text,
  updated_at timestamptz DEFAULT now()
);

-- ── PATCHES ───────────────────────────────────────────────────
-- Public patch meta records
CREATE TABLE IF NOT EXISTS public.patches (
  id          text PRIMARY KEY,        -- e.g. '1.8.90'
  patch_date  text,
  notes       text,
  tiers       jsonb DEFAULT '{}',      -- {S:[...ids], A:[...], B:[...], C:[...], D:[...]}
  compare_to  text REFERENCES public.patches(id),
  hero_notes  jsonb DEFAULT '{}',      -- {heroId: 'note text'}
  created_at  timestamptz DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id)
);

-- ── MATCHES ───────────────────────────────────────────────────
-- Public official MPL/MSC/M-Series match records (read by everyone)
CREATE TABLE IF NOT EXISTS public.matches (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  series_id      text,
  league         text NOT NULL,        -- 'MPL PH' | 'MPL ID' | 'MPL MY' | 'MPL SG' | 'MSC' | 'M-Series' | 'Other'
  season         text,
  stage          text,
  week           text,
  series_format  text DEFAULT 'BO3',
  game_num       integer DEFAULT 1,
  blue_team      text NOT NULL,
  red_team       text NOT NULL,
  winner         text,                 -- 'blue' | 'red' | null
  match_date     date,
  vod            text,
  notes          text,
  blue_bans      text[] DEFAULT '{}',
  red_bans       text[] DEFAULT '{}',
  blue_picks     jsonb DEFAULT '[]',   -- [{name, lane}, ...]
  red_picks      jsonb DEFAULT '[]',
  created_at     timestamptz DEFAULT now(),
  created_by     uuid REFERENCES auth.users(id)
);

-- Index for fast league/team queries
CREATE INDEX IF NOT EXISTS matches_league_idx    ON public.matches(league);
CREATE INDEX IF NOT EXISTS matches_blue_team_idx ON public.matches(blue_team);
CREATE INDEX IF NOT EXISTS matches_red_team_idx  ON public.matches(red_team);
CREATE INDEX IF NOT EXISTS matches_date_idx      ON public.matches(match_date DESC);

-- ── SCRIMS ────────────────────────────────────────────────────
-- Private scrim data — RLS ensures only the owning team can access
CREATE TABLE IF NOT EXISTS public.scrims (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id        uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  opponent       text,
  our_side       text,                 -- 'blue' | 'red'
  series_format  text DEFAULT 'BO3',
  game_num       integer DEFAULT 1,
  blue_team      text,
  red_team       text,
  winner         text,
  match_date     date,
  notes          text,
  blue_bans      text[] DEFAULT '{}',
  red_bans       text[] DEFAULT '{}',
  blue_picks     jsonb DEFAULT '[]',
  red_picks      jsonb DEFAULT '[]',
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scrims_team_id_idx  ON public.scrims(team_id);
CREATE INDEX IF NOT EXISTS scrims_date_idx     ON public.scrims(match_date DESC);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────

ALTER TABLE public.teams    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heroes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrims   ENABLE ROW LEVEL SECURITY;

-- Teams: anyone can read, only own user can write
CREATE POLICY "teams_public_read"  ON public.teams FOR SELECT USING (true);
CREATE POLICY "teams_own_insert"   ON public.teams FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "teams_own_update"   ON public.teams FOR UPDATE USING (id = auth.uid());
CREATE POLICY "teams_own_delete"   ON public.teams FOR DELETE USING (id = auth.uid());

-- Heroes: public read-only (admin manages via Supabase dashboard)
CREATE POLICY "heroes_public_read" ON public.heroes FOR SELECT USING (true);

-- Patches: public read-only
CREATE POLICY "patches_public_read" ON public.patches FOR SELECT USING (true);
CREATE POLICY "patches_auth_insert" ON public.patches FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "patches_own_update"  ON public.patches FOR UPDATE USING (created_by = auth.uid());

-- Matches: public read, auth users can insert/manage their own
CREATE POLICY "matches_public_read"  ON public.matches FOR SELECT USING (true);
CREATE POLICY "matches_auth_insert"  ON public.matches FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "matches_own_update"   ON public.matches FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "matches_own_delete"   ON public.matches FOR DELETE USING (created_by = auth.uid());

-- Scrims: FULLY PRIVATE — only the team that owns them
CREATE POLICY "scrims_team_select" ON public.scrims FOR SELECT USING (team_id = auth.uid());
CREATE POLICY "scrims_team_insert" ON public.scrims FOR INSERT WITH CHECK (team_id = auth.uid());
CREATE POLICY "scrims_team_update" ON public.scrims FOR UPDATE USING (team_id = auth.uid());
CREATE POLICY "scrims_team_delete" ON public.scrims FOR DELETE USING (team_id = auth.uid());

-- ── AUTO-UPDATE TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ── AUTO-CREATE TEAM PROFILE ON SIGNUP ───────────────────────
-- Call this via Supabase Auth hook or handle in your frontend
-- (already handled in warr-lib.js signUp function)

-- ── PROFILES ──────────────────────────────────────────────────
-- Extends auth.users with display name, team affiliation, plan, tokens.
-- One row per user. Created/updated from profile.html.
CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text,                       -- denormalized for admin queries
  display_name    text,
  avatar_url      text,                       -- base64 data-url or storage URL
  team_name       text,                       -- free text or official MPL team name
  team_status     text DEFAULT 'none',        -- 'none' | 'pending' | 'approved' | 'rejected'
  plan            text DEFAULT 'free',        -- 'free' | 'pro' | 'team'
  tokens_used     integer DEFAULT 0,
  tokens_reset_at timestamptz,               -- when tokens_used resets to 0
  is_banned       boolean DEFAULT false,      -- soft-ban flag
  hero_pool       jsonb DEFAULT '[]'::jsonb,  -- user's personal hero pool (array of hero names)
  admin_notes     text,                       -- internal notes visible only to admin
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_team_status_idx ON public.profiles(team_status);
CREATE INDEX IF NOT EXISTS profiles_plan_idx        ON public.profiles(plan);
CREATE INDEX IF NOT EXISTS profiles_email_idx       ON public.profiles(email);

-- Migration: add hero_pool column if upgrading from older schema
-- Run this in Supabase SQL Editor if the table already exists:
-- ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hero_pool jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read and update their own profile
CREATE POLICY "profiles_own_select" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR auth.email() = 'wrrenvillapando@gmail.com');

CREATE POLICY "profiles_own_insert" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_own_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR auth.email() = 'wrrenvillapando@gmail.com');

-- Only admin can delete profiles (soft-ban preferred, but hard delete available)
CREATE POLICY "profiles_admin_delete" ON public.profiles
  FOR DELETE USING (auth.email() = 'wrrenvillapando@gmail.com');

-- Auto-update timestamp
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ── ADMIN: FORCE-DELETE USER ───────────────────────────────────
-- Run this in Supabase SQL Editor to hard-delete a user who can't be removed via UI.
-- Replace USER_UUID with the actual auth.users.id value.
--
--   SELECT auth.uid(); -- (run while signed in as admin to confirm your UID)
--
--   DELETE FROM auth.users WHERE id = 'USER_UUID';
--
-- This cascades to profiles, teams, scrims automatically (ON DELETE CASCADE).
-- Matches they created will have created_by set to NULL (they remain, just unlinked).

-- ── SAMPLE DATA CHECK ─────────────────────────────────────────
-- After setup, verify with:
-- SELECT * FROM public.profiles LIMIT 10;
-- SELECT * FROM public.profiles WHERE team_status = 'pending';
-- SELECT * FROM public.profiles WHERE plan != 'free';
-- SELECT * FROM public.teams LIMIT 5;
-- SELECT * FROM public.matches LIMIT 5;
-- SELECT * FROM public.scrims LIMIT 5; -- (requires auth)
