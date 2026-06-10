# Warr.GG — Session Handoff

Paste a link to this file (or the contents below) into the new Opus 4.8
session so it can pick up where we left off. Trim to taste before pasting.

---

## Project at a glance

**Warr.GG** — MLBB (Mobile Legends: Bang Bang) esports intelligence
platform built for MPL PH/ID/MY/SG coaches. Vanilla JS + HTML + CSS,
Supabase backend (RLS), Netlify hosting. Custom domain `warr-gg.one`
just got pointed at Netlify (DNS swap in flight as of this handoff).

**Repo:** `/Users/warren/Documents/Warr GG`
**Live:** `warr-gg.netlify.app` (custom domain `warr-gg.one` propagating)

## Architecture in 60 seconds

| Page              | Role                                                  |
|-------------------|-------------------------------------------------------|
| `index.html`      | New dashboard-style homepage (replaces old cinematic) |
| `index-cinematic.html` | Backup of the old Galactic Horizon homepage     |
| `draft_board.html`| Live drafting tool with Coach Suggestions panel       |
| `ai_battle.html`  | Practice vs. AI opponent, Coach Suggestions panel     |
| `scout.html`      | Scrim / broadcast match logger + per-team scout reports |
| `heroes.html`     | Per-hero stats, counters, synergies, drafted-against  |
| `stats.html`      | Analysis page (Draft Plan generator, win conditions)  |
| `profile.html`    | User profile + ALL admin tools (Leagues, Teams, Maintenance, Hero Portraits, Hero Banner Slides) |
| `patch_meta.html` | Meta / patch movement view                            |
| `team_manager.html`| Team roster + player management                      |
| `warr-lib.js`     | Shared client lib: WDB (Supabase), WAdmin, compute helpers |
| `warr-nav.js`     | Shared top-nav rendered on every page                 |
| `warr-styles.css` | Apple Glass design system tokens (amethyst + indigo)  |

## Brand

- **Palette:** amethyst `#A888CC` → indigo `#5E5CE6` gradient
- **Background:** cinematic dark `#050509` with subtle nebula glows
- **Logo:** `assets/logo.png` is the nav brand mark (primary version)
- **Favicon:** `assets/favicon.jpg`
- **Typography:** SF Pro Display + SF Mono

## Supabase setup

Three migrations live in `migrations/`:
- `001_hero_portrait_storage.sql` — hero-portraits bucket + overrides table
- `002_hero_portrait_variants.sql` — adds `variant` column (icon | portrait)
- `003_homepage_slides.sql` — homepage hero-banner slides table

All three should be applied. RLS: public read, admin write (matched by email `wrrenvillapando@gmail.com`).

## What we shipped in the last session (most recent first)

The last 30 commits — `git log --oneline -30` for the full list:

- **Hero banner cloud sync + lighter gradient overlay + fix size rec** (1800×600, not 1600×900)
- **Per-variant hero portraits** (icon + portrait)
- **Logo + favicon wired site-wide**, no flash of gradient W
- **Slide background uploader** (Supabase, not Google Drive)
- **Portraits Manager modal** — moved from homepage to Profile admin
- **Slide Editor modal** — moved from homepage to Profile admin
- **Coach Suggestions v4** with composition identity, lookahead, lane-aware counters, player hero pool, BO5 series memory, sandwich ban, first-pick priorities
- **AI Battle UX:** speed up P2 (consecutive AI turns no longer queue 2.5s reveals)
- **Scout bugs squashed:** "match disappears" was 4 separate bugs — see commits `9eb598e`, `65a8350`, `a50bb42`, `43897b2`

## THE OPEN PROBLEM (this is why we're switching sessions)

The user is frustrated with **AI Battle**. Recap:

> "AI Battle keeps picking same lane heroes that they already have. Has a lot of bugs. Not as smart as an advanced MPL level coach."

**Honest diagnosis I gave at end of session:**

`localAI()` in `ai_battle.html` is now ~1000 lines of nested additive
scoring with multiple branches (ENEMY mode vs GENERIC mode), multiple
filter chains, and multiple fallback paths. I've been **patching layers
on top of layers** for the past dozen commits — every new signal (scout
counter, synergy, drafted-against, comp identity, lookahead, sandwich
ban, role caps, first-pick prio) added bug surface without fixing the
structural problem: **scoring is purely additive**, so lane fit can get
outvoted by counter + synergy + meta even when the lane is filled.

### Three paths I laid out — user has NOT picked yet

**Path A — Surgical bug fix (safest).**
Trace the exact bug where duplicate-lane heroes leak through `localAI`,
add a hard pre-filter. ~30 min. Doesn't make it smarter, just stops the
obvious wrong picks.

**Path B — Restructure (real fix).**
Rewrite `localAI` as a **priority-ordered selection pipeline**:
1. Filter: lanes we need, roles under cap, heroes we can use
2. Categorize: counter-pick / synergy / comfort / fill
3. Decide based on draft state (last pick → counter-heavy, blind first → safe-heavy)
4. Score within the chosen category only

~1 day. Replaces ~1000 lines with cleaner structure.

**Path C — Hand the brain to Claude (smartest).**
Promote `claudeAI` from fallback to primary. Give Claude a structured
prompt with scout data, board state, phase, identity, opp tendencies.
Have Claude return the move + reasoning. Keep `localAI` only when no
API key. ~half a day. Real MPL-coach reasoning, costs tokens per turn.

**My honest recommendation:** **A now, then C** — A stops the bleeding
immediately, C gives the actual intelligence ceiling. B is good if user
wants no LLM dependency.

User said "the claude fable your new model" — confused-looking message,
then mentioned wanting Opus 4.8. **Best read: user wants Claude (Opus 4.8)
making the AI Battle decisions**, which is Path C.

## What I'd tell Opus 4.8 to do first

1. **Start with Path A** — quick targeted fix on the duplicate-lane bug.
   Trace `localAI` in `ai_battle.html` and find where the picked hero
   bypasses the slot-fit gate. Common suspect: `_safePickPool` fallback
   when `scored` is empty.

2. **Then Path C** — build a `claudeAI(step)` that constructs a clear
   structured prompt and ranks the available heroes. Existing
   `claudeAI()` skeleton at the top of `ai_battle.html` — replace it.
   Use the user's `WDB.getAdminApiKeySync()` for the API key.

3. **Do NOT add more signals to `localAI`.** Resist the urge. The user
   explicitly does not want more patches stacked on the existing engine.

## User preferences (read carefully)

- **Direct and honest > diplomatic.** When something's bad, say it's bad
  and explain why. The user appreciated when I owned the technical debt
  in my over-engineering.
- **Frustrated by:** silent fixes that don't actually fix the underlying
  bug; over-engineering; adding new features when the existing thing
  doesn't work; long bullet lists.
- **Likes:** clear "here's what I did, why, what to do next" recaps; using
  emojis sparingly (mostly avoided); short responses for short questions.
- **Domain:** MLBB esports, MPL leagues, specifically MPL PH coaching.
  Knows the heroes by lane and role. Don't over-explain MLBB terms.
- **Status:** admin email `wrrenvillapando@gmail.com`. Site is on Netlify,
  domain `warr-gg.one` from GoDaddy (nameserver swap to Netlify done
  this session, propagating).

## Active in-flight items (status)

- ✅ Logo files committed and pushed (commit `561f5bc`)
- ✅ Logo flash on refresh fixed (commit `70ff6a7`) — pending push
- ⏳ Domain DNS propagating (~1-4 hours after nameserver swap at GoDaddy)
- ⏳ Hero banner cloud sync — user needs to run migration `003_homepage_slides.sql`
  AND re-save slides in Profile editor before they show site-wide
- 📋 AI Battle architectural fix — user about to start a new session in
  Opus 4.8 to tackle this

## Quick-paste-into-new-session prompt

```
I'm continuing work on Warr.GG (an MLBB esports intelligence platform).
The previous session was in Claude Opus 4.7 and I'm switching to 4.8 to
work on the AI Battle problem. Please read HANDOFF.md in
/Users/warren/Documents/Warr GG/ for full context, then ask me what to
do first. The AI Battle architectural decision (paths A / B / C in the
handoff) is the open question.
```

## Local git state at session end

```
30+ commits ahead of origin... wait, scratch that — we pushed ~commit
561f5bc, then made 70ff6a7. So 1 commit ahead of origin/main right now.
Push with: git push origin main
```

Once pushed and DNS propagates and migration 003 is run, all the
recent work (logo, banner gradient, portrait variants, slide cloud
sync) goes live for all visitors.
