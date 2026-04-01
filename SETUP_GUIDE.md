# Warr.GG — Live Deployment Guide

This guide covers everything needed to get Warr.GG live with login-protected access and invite-only users.

---

## Part 1 — Supabase (Backend / Auth)

### 1.1 Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New Project** → choose a name (e.g. `warr-gg`) → set a database password → **Create**
3. Wait ~2 minutes for the project to provision

### 1.2 Get Your API Keys

1. In your Supabase project, go to **Settings → API**
2. Copy two values:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — the long `eyJ...` string
3. Open `warr-engine/warr-lib.js` and paste them here:

```js
const WARR_CONFIG = {
  supabaseUrl:     'https://YOUR_PROJECT_ID.supabase.co',  // ← paste Project URL
  supabaseAnonKey: 'YOUR_ANON_KEY_HERE',                   // ← paste anon key
};
```

### 1.3 Create the Profiles Table

1. In Supabase, go to **SQL Editor** → click **New Query**
2. Paste and run this SQL:

```sql
-- User profiles (display name + optional team name)
CREATE TABLE public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  team_name     text,
  created_at    timestamptz DEFAULT now()
);

-- Allow users to read and write only their own profile
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can upsert their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);
```

3. Click **Run** — you should see "Success, no rows returned"

### 1.4 Create the Scout Matches & Draft Saves Tables

In the same **SQL Editor**, run a **second** query with this SQL:

```sql
-- ═══════════════════════════════════════════
-- SCOUT MATCHES — shared across all users
-- (MPL, tournament, and public match data)
-- ═══════════════════════════════════════════
CREATE TABLE public.scout_matches (
  id          text PRIMARY KEY,           -- match's local id, e.g. 'match_1234'
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id),
  data        jsonb NOT NULL              -- full match object stored as JSON
);

ALTER TABLE public.scout_matches ENABLE ROW LEVEL SECURITY;

-- All signed-in users can read all matches (shared team intel)
CREATE POLICY "All users can read matches"
  ON public.scout_matches FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any signed-in user can add matches
CREATE POLICY "All users can insert matches"
  ON public.scout_matches FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Whoever created it (or admin) can update it
CREATE POLICY "Creator can update match"
  ON public.scout_matches FOR UPDATE
  USING (auth.uid() = created_by OR created_by IS NULL);

-- Whoever created it (or admin) can delete it
CREATE POLICY "Creator can delete match"
  ON public.scout_matches FOR DELETE
  USING (auth.uid() = created_by OR created_by IS NULL);


-- ═══════════════════════════════════════════
-- DRAFT SAVES — private per user account
-- (each analyst's own saved drafts)
-- ═══════════════════════════════════════════
CREATE TABLE public.draft_saves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) NOT NULL,
  created_at  timestamptz DEFAULT now(),
  name        text NOT NULL DEFAULT 'Draft',
  data        jsonb NOT NULL              -- full draft state stored as JSON
);

ALTER TABLE public.draft_saves ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their OWN saved drafts
CREATE POLICY "Own drafts only"
  ON public.draft_saves FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

4. Click **Run** — both tables will be created with security rules

**What this means in practice:**
- **Scout matches** — when anyone on your team enters an MPL match, all users see it instantly on their next page load
- **Draft saves** — each user's saved drafts (from the Draft Board) are private to their account; no one else can see or modify them
- **AI Battle** — stays completely local (localStorage only), nothing is synced

### 1.5 Configure Auth Settings

1. Go to **Authentication → Settings**
2. Under **Email**, make sure **Enable Email Signup** is turned **OFF**
   - This prevents anyone from registering themselves — only your invite links work
3. Under **URL Configuration**, set **Site URL** to your Netlify domain (you'll get this in Part 2)
   - Example: `https://warr-gg.netlify.app`
4. Under **Redirect URLs**, add the same domain:
   - `https://warr-gg.netlify.app`
   - `https://warr-gg.netlify.app/auth.html`

### 1.5 Invite Your Users

Once the site is live (after Part 2), do this for every person you want to give access:

1. Go to **Authentication → Users** in Supabase
2. Click **Invite User**
3. Enter their email address → **Send Invite**
4. They receive an email with a link → they click it → they land on your site at `auth.html`
5. They enter their **name** (required) and **team name** (optional), set a password, and they're in
6. They can now log in any time with email + password

---

## Part 2 — Deploy on Netlify

### 2.1 Prepare Your Files

Make sure `warr-lib.js` already has your Supabase URL and anon key filled in (step 1.2 above).

### 2.2 Deploy

**Option A — Drag and drop (easiest):**
1. Go to [netlify.com](https://netlify.com) and sign up (free)
2. From the dashboard, drag your entire `warr-engine/` folder onto the page where it says "Drag and drop your site folder here"
3. Netlify gives you a URL like `https://amazing-name-123.netlify.app`
4. That's it — your site is live!

**Option B — GitHub (better for updates):**
1. Push your `warr-engine/` folder to a GitHub repository
2. On Netlify: **Add new site → Import from Git → GitHub**
3. Select your repo → set **Publish directory** to `warr-engine` → **Deploy**
4. Future updates: just push to GitHub and Netlify auto-redeploys

### 2.3 Set Your Custom Domain (optional)

1. In Netlify: **Domain management → Add custom domain**
2. Follow the DNS instructions they provide

---

## Part 3 — After Going Live

### Giving Access to Someone

1. Supabase Dashboard → **Authentication → Users → Invite User**
2. Enter their email → **Send Invite**
3. They get an email, click the link, set up their profile and password
4. Done — they can now log in

### Revoking Access

1. Supabase Dashboard → **Authentication → Users**
2. Find the user → **Delete** (they can no longer sign in)

### Changing the Site URL After Deploy

If your Netlify URL changes or you add a custom domain:
1. Supabase → **Authentication → Settings → URL Configuration**
2. Update **Site URL** and **Redirect URLs** to match

---

## Part 4 — Quick Reference

| What | Where |
|------|-------|
| Supabase Project URL | Settings → API |
| Supabase Anon Key | Settings → API |
| Invite a user | Authentication → Users → Invite |
| Disable self-signup | Authentication → Settings → Email Signup = OFF |
| Profiles table | SQL Editor (created in step 1.3) |
| Netlify deploy | netlify.com → drag warr-engine/ folder |
| Your live URL | Netlify dashboard → Domains |

---

## Troubleshooting

**"Invalid login credentials"** — Email or password is wrong. Reset via Supabase: Authentication → Users → find user → Send Password Reset.

**Invite link expired** — Supabase invite links expire after 24 hours by default. Re-invite the user from Authentication → Users.

**Redirecting to auth.html but already logged in** — Check that your Supabase URL and anon key in `warr-lib.js` are correct and match your project.

**User lands on auth.html but invite form doesn't appear** — Make sure your Netlify site URL is set correctly in Supabase's redirect URLs (step 1.4).
