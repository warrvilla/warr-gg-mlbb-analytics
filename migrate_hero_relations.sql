-- ─────────────────────────────────────────────────────────────────
-- Warr.GG — Create `hero_relations` table for admin-curated counters
-- and synergies shown on the Heroes page.
--
-- Run this in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
-- ─────────────────────────────────────────────────────────────────

-- Ensure updated_at trigger function exists (also defined in the leagues migration)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS public.hero_relations (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hero          text NOT NULL,                       -- the primary hero (e.g. "Fredrinn")
  type          text NOT NULL,                       -- 'counter' or 'synergy'
  related_hero  text NOT NULL,                       -- the counter / best-with hero
  slot          smallint NOT NULL DEFAULT 0,         -- 0, 1, 2 — display order (top 3)
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id),
  CONSTRAINT hero_relations_type_chk CHECK (type IN ('counter','synergy')),
  CONSTRAINT hero_relations_uniq UNIQUE (hero, type, slot)
);

CREATE INDEX IF NOT EXISTS hero_relations_hero_type_idx
  ON public.hero_relations (hero, type);

ALTER TABLE public.hero_relations ENABLE ROW LEVEL SECURITY;

-- Everyone can read the curated relations
DROP POLICY IF EXISTS "hero_relations_public_read"   ON public.hero_relations;
CREATE POLICY "hero_relations_public_read"
  ON public.hero_relations
  FOR SELECT USING (true);

-- Only the admin email can write (insert / update / delete)
DROP POLICY IF EXISTS "hero_relations_admin_insert"  ON public.hero_relations;
DROP POLICY IF EXISTS "hero_relations_admin_update"  ON public.hero_relations;
DROP POLICY IF EXISTS "hero_relations_admin_delete"  ON public.hero_relations;
CREATE POLICY "hero_relations_admin_insert"
  ON public.hero_relations
  FOR INSERT
  WITH CHECK (auth.email() = 'wrrenvillapando@gmail.com');
CREATE POLICY "hero_relations_admin_update"
  ON public.hero_relations
  FOR UPDATE
  USING (auth.email() = 'wrrenvillapando@gmail.com');
CREATE POLICY "hero_relations_admin_delete"
  ON public.hero_relations
  FOR DELETE
  USING (auth.email() = 'wrrenvillapando@gmail.com');

-- Keep updated_at fresh on UPDATE (re-uses handle_updated_at from earlier migration)
DROP TRIGGER IF EXISTS hero_relations_updated_at ON public.hero_relations;
CREATE TRIGGER hero_relations_updated_at
  BEFORE UPDATE ON public.hero_relations
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Tell PostgREST to reload its schema cache so the new table shows up
NOTIFY pgrst, 'reload schema';

-- Quick verify
SELECT
  (SELECT count(*) FROM public.hero_relations) AS hero_relations_rows;
