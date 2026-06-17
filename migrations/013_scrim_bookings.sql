-- Warr.GG — 013: Scrim bookings (Phase 2 — schedule + calendar)
-- When two teams agree on a scrim it becomes a booking row. Both teams' calendars
-- read from this table. Visible/editable ONLY to the two teams involved.

CREATE TABLE IF NOT EXISTS public.scrim_bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid REFERENCES public.scrim_listings(id) ON DELETE SET NULL,
  team_a       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE, -- proposer
  team_b       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,                     -- the listing owner
  team_a_name  text NOT NULL,
  team_b_name  text NOT NULL,
  scrim_at     timestamptz NOT NULL,        -- agreed date + time
  timezone     text,                         -- display tz e.g. GMT+8
  format       text,                         -- BO3 / BO5 / "5 games" / Flexible
  note         text,
  status       text DEFAULT 'proposed',      -- 'proposed' / 'confirmed' / 'cancelled' / 'completed'
  proposed_by  uuid DEFAULT auth.uid(),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE public.scrim_bookings ENABLE ROW LEVEL SECURITY;

-- Only the two teams involved can see/manage a booking.
DROP POLICY IF EXISTS "booking read own" ON public.scrim_bookings;
CREATE POLICY "booking read own" ON public.scrim_bookings
  FOR SELECT USING ( team_a = auth.uid() OR team_b = auth.uid() );

-- INSERT: you propose as yourself (team_a), to someone else (team_b).
DROP POLICY IF EXISTS "booking insert" ON public.scrim_bookings;
CREATE POLICY "booking insert" ON public.scrim_bookings
  FOR INSERT WITH CHECK ( team_a = auth.uid() AND team_b <> auth.uid() );

-- UPDATE / DELETE: either party (confirm, reschedule, cancel).
DROP POLICY IF EXISTS "booking update" ON public.scrim_bookings;
CREATE POLICY "booking update" ON public.scrim_bookings
  FOR UPDATE USING ( team_a = auth.uid() OR team_b = auth.uid() )
            WITH CHECK ( team_a = auth.uid() OR team_b = auth.uid() );
DROP POLICY IF EXISTS "booking delete" ON public.scrim_bookings;
CREATE POLICY "booking delete" ON public.scrim_bookings
  FOR DELETE USING ( team_a = auth.uid() OR team_b = auth.uid() );

CREATE INDEX IF NOT EXISTS idx_scrim_bookings_parties
  ON public.scrim_bookings (team_a, team_b, scrim_at);
