-- Warr.GG — 012: Scrim Finder (Phase 1 — listings board)
-- A place where teams post "looking for a scrim" and find opponents.
-- Free for all authenticated users; light anti-spam via a 3-open-listing cap
-- and 7-day auto-expiry. Connecting happens via the contact each poster chooses
-- to share (WhatsApp / Discord / Messenger / IGN). In-app chat + bookings +
-- calendar are Phase 2 (separate migration).

-- Ensure the ban flag exists (some deployments never added it). The anti-spam
-- trigger below reads it; without this column the INSERT errors out.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned boolean DEFAULT false;

-- ─────────────────────────────────────────────────────────────
-- scrim_listings
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scrim_listings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  team_name      text NOT NULL,
  region         text,
  tier           text DEFAULT 'amateur',     -- 'pro' / 'semi-pro' / 'amateur' (self-declared)
  rank_tier      text,                        -- e.g. Mythic, Mythical Glory
  format_type    text DEFAULT 'flexible',     -- 'bestof' / 'count' / 'flexible'
  games_planned  int,                         -- 1..7 or the BO number
  open_to        text DEFAULT 'any',          -- 'pro' / 'amateur' / 'any'
  availability   text,                        -- free text, e.g. "Weekdays 8-11pm"
  timezone       text,
  contact_method text DEFAULT 'whatsapp',     -- 'whatsapp' / 'discord' / 'messenger' / 'ign'
  contact_value  text,
  notes          text,
  anonymous      boolean DEFAULT false,       -- hide team identity on the public board
  status         text DEFAULT 'open',         -- 'open' / 'closed' / 'filled'
  created_at     timestamptz DEFAULT now(),
  expires_at     timestamptz DEFAULT now() + interval '7 days'
);

ALTER TABLE public.scrim_listings ENABLE ROW LEVEL SECURITY;

-- READ: any authenticated user sees live (open, unexpired) listings, and always
-- sees their own (so they can manage closed/filled ones).
DROP POLICY IF EXISTS "read live or own" ON public.scrim_listings;
CREATE POLICY "read live or own" ON public.scrim_listings
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND ( (status = 'open' AND expires_at > now()) OR created_by = auth.uid() )
  );

-- INSERT: only as yourself.
DROP POLICY IF EXISTS "insert own" ON public.scrim_listings;
CREATE POLICY "insert own" ON public.scrim_listings
  FOR INSERT WITH CHECK ( created_by = auth.uid() );

-- UPDATE / DELETE: only your own rows.
DROP POLICY IF EXISTS "update own" ON public.scrim_listings;
CREATE POLICY "update own" ON public.scrim_listings
  FOR UPDATE USING ( created_by = auth.uid() ) WITH CHECK ( created_by = auth.uid() );
DROP POLICY IF EXISTS "delete own" ON public.scrim_listings;
CREATE POLICY "delete own" ON public.scrim_listings
  FOR DELETE USING ( created_by = auth.uid() );

CREATE INDEX IF NOT EXISTS idx_scrim_listings_live
  ON public.scrim_listings (status, expires_at);

-- ── Anti-spam: block banned users, cap 3 OPEN listings per user ──
CREATE OR REPLACE FUNCTION public.scrim_listing_guard()
RETURNS trigger AS $$
DECLARE
  open_count int;
  banned     boolean;
BEGIN
  SELECT is_banned INTO banned FROM public.profiles WHERE id = NEW.created_by;
  IF banned THEN
    RAISE EXCEPTION 'Banned accounts cannot post scrim listings.';
  END IF;
  SELECT count(*) INTO open_count
    FROM public.scrim_listings
    WHERE created_by = NEW.created_by AND status = 'open' AND expires_at > now();
  IF open_count >= 3 THEN
    RAISE EXCEPTION 'You already have 3 open scrim listings — close one before posting another.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_scrim_listing_guard ON public.scrim_listings;
CREATE TRIGGER trg_scrim_listing_guard
  BEFORE INSERT ON public.scrim_listings
  FOR EACH ROW EXECUTE FUNCTION public.scrim_listing_guard();

-- ─────────────────────────────────────────────────────────────
-- scrim_reports (moderation)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scrim_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES public.scrim_listings(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  reason      text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (listing_id, reported_by)             -- one report per user per listing
);

ALTER TABLE public.scrim_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report insert" ON public.scrim_reports;
CREATE POLICY "report insert" ON public.scrim_reports
  FOR INSERT WITH CHECK ( reported_by = auth.uid() );
DROP POLICY IF EXISTS "report read own" ON public.scrim_reports;
CREATE POLICY "report read own" ON public.scrim_reports
  FOR SELECT USING ( reported_by = auth.uid() );

-- Admin moderation (view all listings/reports, remove abusive posts, ban) runs
-- through the service-role admin function (netlify/functions/admin.mjs),
-- bypassing RLS — same pattern as user moderation. No public admin policy here.
