-- MLBB Top 100 Global Snapshots
-- Run this once in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS top100_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  scraped_at    DATE        NOT NULL,
  total_players INTEGER,
  heroes        JSONB       NOT NULL,
  raw           JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One snapshot per calendar day (re-running same day overwrites)
CREATE UNIQUE INDEX IF NOT EXISTS top100_snapshots_date_idx
  ON top100_snapshots (scraped_at);

-- Allow warr.gg frontend (anon key) to read
ALTER TABLE top100_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"
  ON top100_snapshots FOR SELECT
  USING (true);

-- Only service role can insert/update (the scraper script)
CREATE POLICY "Service write"
  ON top100_snapshots FOR ALL
  USING (auth.role() = 'service_role');
