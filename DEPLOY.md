# Warr.GG — Launch Guide
## GitHub → Supabase → Vercel (All Free Tier)

---

## Step 1 — Set Up Supabase (5 minutes)

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Name it `warr-engine`, choose a strong database password
3. Select the region closest to your players (Singapore recommended for SEA)
4. Wait ~2 minutes for the project to spin up

### Run the Database Schema
1. In your Supabase dashboard → **SQL Editor** → **New Query**
2. Copy the entire contents of `schema.sql` and paste it
3. Click **Run** — you should see "Success. No rows returned"

### Get Your API Keys
1. Go to **Settings → API**
2. Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (a long JWT string)

---

## Step 2 — Configure warr-lib.js (2 minutes)

Open `warr-lib.js` and update these two lines near the top:

```javascript
const WARR_CONFIG = {
  supabaseUrl:     'https://YOUR_PROJECT_ID.supabase.co',  // ← paste here
  supabaseAnonKey: 'YOUR_ANON_KEY_HERE',                   // ← paste here
};
```

That's the only config change needed.

---

## Step 3 — Push to GitHub (3 minutes)

```bash
# In your warr-engine folder:
git init
git add .
git commit -m "feat: Warr.GG launch-ready with Supabase integration"

# Create repo at github.com/new (name: warr-engine, public or private)
git remote add origin https://github.com/YOUR_USERNAME/warr-engine.git
git branch -M main
git push -u origin main
```

---

## Step 4 — Deploy to Vercel (3 minutes)

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your `warr-engine` GitHub repository
3. Framework Preset: **Other** (it's plain HTML)
4. Root directory: leave as `/`
5. Click **Deploy** — done in ~30 seconds!

Your site will be live at `warr-engine.vercel.app` (or your custom domain).

### Optional: Set Env Variables in Vercel
Instead of hardcoding keys in warr-lib.js, you can use Vercel environment variables:

In Vercel → Project Settings → Environment Variables:
- `WARR_SUPABASE_URL` = your Supabase URL
- `WARR_SUPABASE_ANON` = your anon key

Then at the very top of each HTML file's `<head>`, add:
```html
<script>
  window.WARR_SUPABASE_URL  = '%%WARR_SUPABASE_URL%%';
  window.WARR_SUPABASE_ANON = '%%WARR_SUPABASE_ANON%%';
</script>
```
(Vercel will replace the `%%VAR%%` tokens at build time with `@vercel/static-config`)

For plain HTML, the simplest approach is just to put the keys directly in warr-lib.js — the **anon key is safe to be public** (Supabase is designed for this; RLS policies protect your data).

---

## Step 5 — Migrate Existing Data (Optional)

If you have data in Excel sheets, import it into Supabase:

### Via Scout Page (Recommended)
1. Open your deployed site
2. Go to **Scout** page
3. Click "📂 Load Sheet" and select your .xlsx file (backward compat kept)
4. Once data is visible, click **☁ Load from Cloud** → **Sync to Cloud** to push to Supabase

### Via Migration Helper
Open browser console on any page and run:
```javascript
// Export your localStorage data to JSON
WMigrate.exportToJSON();
// This downloads warr_migration_export.json

// Then import that JSON into Supabase:
const json = /* paste JSON here */;
await WMigrate.importFromJSON(json);
```

---

## Data Architecture Summary

| Data Type | Who Can See | Who Can Write |
|-----------|-------------|---------------|
| MPL PH/ID/MY/SG matches | Everyone (public) | Any signed-in user |
| MSC / M-Series matches | Everyone (public) | Any signed-in user |
| Scrim matches | Only your team | Only your team |
| Patch tier lists | Everyone (public) | Any signed-in user |
| Hero roster | Everyone (public) | Admin (Supabase dashboard) |

**How scrim privacy works**: Supabase Row Level Security (RLS) ensures that when your team queries scrim data, it only returns rows where `team_id = your_auth_user_id`. Other teams cannot see, query, or guess your scrim data even if they know the table name.

---

## File Structure

```
warr-engine/
├── index.html          → redirect to draft_board.html (create this)
├── draft_board.html    → main draft tool
├── ai_battle.html      → AI vs Human draft
├── scout.html          → team scouting + data entry
├── stats.html          → match reports
├── patch_meta.html     → hero tier lists
├── auth.html           → login / register
├── warr-lib.js         → shared Supabase client ← CONFIGURE THIS
├── schema.sql          → run once in Supabase SQL editor
└── DEPLOY.md           → this file
```

### Create index.html (redirects to main tool):
```html
<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=draft_board.html"></head></html>
```

---

## Custom Domain (Optional)

1. Buy a domain (Namecheap, Cloudflare, etc.)
2. Vercel → Project Settings → Domains → Add your domain
3. Follow the DNS instructions (takes ~5 minutes to propagate)

---

## Troubleshooting

**"Failed to fetch" errors** → Check your Supabase URL and anon key in warr-lib.js

**"Row Level Security policy violation"** → User needs to be signed in to access scrims. Make sure `WAuth.init()` runs before any DB calls.

**Auth emails not arriving** → In Supabase → Authentication → Settings, check "Confirm email" and set your email provider.

**Hero images not loading** → The app uses `https://mlbb.io` or similar CDN for images. If those break, you'll need to self-host images.

**Vercel 404 on page refresh** → Add a `vercel.json` file:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/$1" }] }
```

---

*Warr.GG — Built for MPL SG & the MLBB esports community*
