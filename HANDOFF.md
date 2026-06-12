# Warr.GG — Session Handoff

Read this first when continuing work on Warr.GG.

## Project at a glance

**Warr.GG** — MLBB esports intelligence platform for MPL coaches, now
**release-ready with public accounts**. Vanilla JS + HTML + CSS, Supabase
(auth + RLS), Netlify (hosting + serverless functions). Live at
`warr-gg.one` / `warr-gg.netlify.app`. Owner/admin: wrrenvillapando@gmail.com.

## Site structure (post-release-prep)

| Page | Role |
|---|---|
| `index.html` | Homepage — Meta Hierarchies (dynamic league tabs), intel feed |
| `ai_battle.html` | THE draft arena: war-room setup, Draft Brain v2, PvP hotseat, vs AI, vs scouted teams, BO1/3/5/7 series, live win probability, coach panel |
| `scout.html` | Match logging + team reports (league list incl. MPL KH + custom) |
| `stats.html` | Analysis — scouting report + **Enemy Draft Book** (mined top comps, ★ best draft, phase-1 openers, target bans) |
| `heroes.html` | Hero grid + centered deep-dive modal (priority stats, all maps, who-plays-it) |
| `team_manager.html` | Teams & rosters, league filter chips, glass facelift |
| `profile.html` | Tabbed: Profile / Hero Pool / Plan & Tokens / Account + admin tabs (Leagues, Teams, Site Content incl. AI key card) |
| `admin.html` | User control: plans w/ expiry, ban, full delete, team approvals |
| `auth.html` | Sign in + **self-service signup** + invite + reset |
| RETIRED | `draft_board.html`, `patch_meta.html` — 301 redirects, files kept |
| `netlify/functions/claude.mjs` | AI proxy: auth-gated, plan-aware, budget-capped |
| `netlify/functions/admin.mjs` | Service-role: delete_user / set_plan / ban_user |

## The Draft Brain v2 (ai_battle.html, spec in DRAFT_LOGIC.md)

Slot-aware pipeline replacing the old additive scoring:
LEGAL (lane-ledger bipartite feasibility) → NEEDS (comp gates) → INTENT
(per-slot questions, counter-timing discipline) → CANDIDATES → RANK →
EXPLAIN. Evidence hierarchy: team-on-side → team → league → overall →
patch sheet, confidence-blended, 90-day recency decay. GM layer: ban
equity, predict-then-deny, threat check, lookahead, anti-meta. Dynamic
flex-lane re-resolution (resolveTeamLanesAB). `claudeAI` = Claude
reasoning over the brain's vetted shortlist (paid/admin only), local
brain for free users. Coach panel runs the same brain forHuman.

## Monetization & cost protection

- Plans: Free ₱0 (3 analyses/mo) · Pro ₱199/mo (100) · Team ₱4,999/mo
  (1,000 pooled, 2 accounts). Manual activation via email/GCash.
- Server-enforced: free 10 calls/mo, Pro 60/day, Team 200/day, global
  budget cap ₱5,000/mo (Netlify Blobs metering, real token costs).
- Plans auto-expire via profiles.plan_expires_at (admin grants N months).
- Migrations 004/005/006: plan column locked, site_config admin-only,
  expiry + service-role-compatible trigger. ALL RUN by owner (2026-06-11).

## Netlify env vars (owner manages)

`ANTHROPIC_API_KEY` (set), `SUPABASE_SERVICE_ROLE_KEY` (for admin.mjs),
optional: MONTHLY_BUDGET_PHP, USER_DAILY_CALLS, TEAM_DAILY_CALLS,
FREE_MONTHLY_CALLS, ADMIN_EMAIL.

## Conventions

- Clean URLs (netlify.toml rewrites); nav rendered by warr-nav.js
  (Home first, Profile = avatar button beside auth chip).
- Leagues are DYNAMIC: WDB.initLeagues() merges admin-created leagues
  into PUBLIC_LEAGUES/LOCKED_LEAGUES; chip rows render from
  WDB.officialLeagues(); 'warr-leagues-ready' event for late UI.
- Glass design tokens from warr-styles.css everywhere; amethyst #A888CC
  → indigo #5E5CE6 gradient; AI Battle setup centers via
  .setup-inner{margin:auto} (do NOT use flex spacers — clips buttons).
- Test harnesses in the session outputs folder pattern: headless vm
  load of page scripts + fixture scout data (sim_harness, pvp, series,
  leagues, profile, draftbook tests).

## Late-session additions (after the main rewrite)

- Signup collects IGN / phone / birthday (required) → auth metadata →
  profile on first-login setup. Migration 007.
- Admin: click a user's email → details modal (contact, age, plan,
  actions). Search matches IGN + phone digits.
- Admin: 📊 Audience Analytics board (active 7d/30d via last_seen_at
  heartbeat — migration 008, MRR, age demographics, signup trend,
  Copy Sponsor Snapshot button).
- Supabase: signups enabled + email confirmation ON (owner did this).
- Migrations status: 004–009 RUN by owner; **010 pending** (is_comp flag
  + trigger update — comped accounts excluded from MRR).
- Comp accounts: grant flow asks Complimentary vs Paid; user details
  modal has Mark as COMP/PAID toggle for retroactive fixes. Analytics:
  'Paying users' + MRR = real money only; 'Comped (free)' separate.
- Admin entry moved from nav chip to Profile → gold '⚙ Admin Panel' tab.
- Nav: auth chip shows Admin link only when WAdmin.isAdmin(); Sign Out
  confirms. Scout LANDS ON Teams view (click team → full report). Free
  users can only log/delete Scrims/AI Battle (official leagues hidden in
  entry modal; MPL already admin-write + creator-delete only).
- #7 (player/team performance) ALREADY BUILT: scout team report →
  Per-Lane Roster (player → hero pool + WR + KDA) + Top Picks + first
  turtle/lord/blood, blue/red WR. Works for own team + enemies, scrim+MPL.
- Owner's next session starts with: run 007+008, push, full stranger-
  account test (signup → confirm email → draft → 3 analyses → cap →
  grant Pro → expiry shows → delete).

## Known leftovers / nice-to-haves

- XSS pass on older pages rendering user text via innerHTML (moderate).
- IG/TikTok contact buttons pending owner's handles.
- Draft report card + what-if explorer (designed, not built).
- Pro price test ₱149 vs ₱199 once there's revenue signal.
- index-cinematic.html is an unused backup of the old homepage.

## User preferences (unchanged — read carefully)

Direct and honest > diplomatic. Hates: silent non-fixes, over-engineering,
long bullet lists, walls of text. Likes: short recaps with "what I did,
why, what's next". Knows MLBB deeply — don't explain esports terms.
