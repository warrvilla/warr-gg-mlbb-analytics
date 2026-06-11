-- Warr.GG — 007: registration contact fields
-- IGN, phone, birthday collected at signup. Visible to the user themselves
-- (own-row RLS) and to the admin via the existing admin read path.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ign      text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone    text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday date;
