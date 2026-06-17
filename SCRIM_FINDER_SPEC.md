# Warr.GG — Scrim Finder (design spec)

Status: **proposed, not built**. This is the plan to review before any code.
Owner/admin: wrrenvillapando@gmail.com.

## 1. What it is

A place where teams — pro, MPL, and **amateur** — post "looking for a scrim"
and find an opponent. A team posts who they are, the rank/format they want,
and when they're free; other teams browse, filter, and reach out.

## 2. The two decisions, and my recommendation

You said "I don't know what's best" on both — here's the call and why.

**How teams connect → Listings board first, in-app chat as Phase 2.**
A board where you post a scrim request and connect via your chosen contact
(Discord / Messenger / IGN) ships in days and is immediately useful. Building
a full chat system up front triples the work and delays launch. We add real
in-app chat right after, once there are listings worth replying to.

**Who can use it → Everyone, including free and amateur.**
A scrim finder lives or dies on how many active listings it has. Gating
posting behind Pro would empty the board and kill it before it starts — and
it directly contradicts your goal of helping amateur teams. Keep the core
free; we monetize elsewhere (the AI) and can add *optional* paid perks later
(a pinned/boosted listing, a verified-team badge) without ever locking the
core feature.

The risk of "everyone" is spam/abuse. That's handled with light controls
(post limits, expiry, report button, admin removal — section 6), not by
locking people out.

## 3. Data model (Supabase, migration 012)

### `scrim_listings`
| column | type | notes |
|---|---|---|
| id | uuid pk | default gen_random_uuid() |
| created_by | uuid | = auth.uid(), FK auth.users |
| team_id | uuid null | FK teams if they have one; else null |
| team_name | text | shown name (from team or typed) |
| region | text | MPL region or "Amateur" / country |
| rank_tier | text | e.g. Mythic, Mythical Glory, Pro, Amateur |
| format_type | text | 'count' (play N flat) / 'bestof' (BO3/5/7) / 'flexible' |
| games_planned | int | how many games, e.g. 1–7 (or the BO number) |
| availability | text | free text, e.g. "Weekdays 8–11pm" |
| timezone | text | e.g. GMT+8 |
| contact_method | text | whatsapp / discord / messenger / ign / in-app |
| contact_value | text | handle or number; null if in-app only |
| notes | text | optional blurb |
| open_to | text | who they'll play: 'pro' / 'amateur' / 'any' (default 'any') |
| anonymous | bool | hide team identity on the public board (default false) |
| status | text | 'open' / 'closed' / 'filled' (default 'open') |
| created_at | timestamptz | default now() |
| expires_at | timestamptz | default now() + 7 days (auto-stale) |

### `scrim_reports` (moderation)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| listing_id | uuid | FK scrim_listings |
| reported_by | uuid | = auth.uid() |
| reason | text | |
| created_at | timestamptz | default now() |

### `scrim_bookings` (the agreement → calendar record)
Created when two teams **agree** on a scrim. This is the row both calendars read.
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| listing_id | uuid null | the listing it came from (if any) |
| team_a | uuid | proposing team's user (created_by) |
| team_b | uuid | accepting team's user |
| team_a_name | text | editable display name (defaults to team profile) |
| team_b_name | text | editable — opponent is often an unregistered amateur team |
| scrim_at | timestamptz | the agreed date + time |
| timezone | text | display tz, e.g. GMT+8 |
| format_type | text | 'count' / 'bestof' / 'flexible' |
| games_planned | int | agreed number of games (1–7, or BO number) |
| games_played | int | how many actually got logged (default 0) |
| status | text | 'proposed' / 'confirmed' / 'in_progress' / 'completed' / 'partial' / 'cancelled' |
| proposed_by | uuid | who set the time |
| created_at | timestamptz | default now() |

### `scrim_notes` (private per-team notes & VOD links)
A team's own notes/VOD for a scrim, **visible only to them** — never the
opponent. One row per (booking, owner) so RLS can lock it down (RLS is
row-level, so a private field can't be a column on the shared booking).
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| booking_id | uuid | FK scrim_bookings |
| owner | uuid | = auth.uid(); the only one who can read it |
| note | text | free-text prep notes |
| vod_url | text | link to their VOD/replay (can repeat for several) |
| created_at / updated_at | timestamptz | |

RLS: SELECT / INSERT / UPDATE / DELETE **only** where `owner = auth.uid()`.
The other team on the same booking literally cannot query these rows — and
neither can anyone else. (Admin override left out here on purpose: private
prep stays private; moderation acts on listings/reports, not VODs.)

### Phase 2 (chat) — `scrim_threads` + `scrim_messages`
Added later: one thread per (listing, interested team), messages with
sender/body/created_at, `read_at` for unread badges. Supabase Realtime
pushes new messages live. Not in Phase 1.

## 4. RLS policies (the security model)

- **SELECT** `scrim_listings`: any authenticated user can read `status='open'`
  and not expired. (Browsing is the whole point.)
- **INSERT**: authenticated, `created_by = auth.uid()`. A trigger caps each
  user to **3 open listings** to stop board flooding.
- **UPDATE / DELETE**: only `created_by` — or admin (existing admin check).
- **`scrim_reports` INSERT**: any authenticated user, once per listing.
- Banned users (existing `profiles.is_banned`) are blocked from INSERT.

Mirrors the patterns already in migrations 004–011, so it slots into the
existing RLS setup cleanly.

## 5. Pages & UI

New page **`scrims.html`** → clean URL **/scrims** (add the redirect in
netlify.toml, add a nav entry in warr-nav.js). Reuses the glass design
tokens already in warr-styles.css.

- **Board (default):** filter chips for region, rank, format, and "available
  now/this week". Each listing is a card: team name + region + rank, format,
  availability, notes, and a **Contact** button (opens Discord/Messenger/IGN)
  plus a **Report** button.
- **Post a Scrim** modal: team (auto-filled if they have one), region, rank,
  format, availability, timezone, contact method, notes. Validates and inserts.
- **My Listings** tab: edit / mark filled / close / delete your own posts.
- Empty state that nudges the first posters ("Be the first — post a scrim").

**Contact privacy:** we do **not** expose the phone number collected at
signup. The poster explicitly chooses what handle to share (Discord is the
norm for scrims). In-app chat (Phase 2) removes the need to share anything.

**"Message on WhatsApp" button.** When a team picks WhatsApp as their contact,
the card shows a green **Message on WhatsApp** button. Clicking it opens a chat
with them directly via a `https://wa.me/<number>` deep link (optionally
pre-filled, e.g. "Hi, saw your scrim post on Warr.GG…") — opens the WhatsApp
app on mobile or WhatsApp Web on desktop, no number typing. The number is only
the one they chose to share for scrims, never their signup phone. Same
click-to-chat pattern works for Discord / Messenger; WhatsApp is just the
first-class one since it's how most teams here actually talk.

## 5a. Team tiers, verification & pro ↔ amateur scrims

**Identifying pro teams.** You already have an admin team-approval flow. We
extend the `teams` table with:
- `tier` — 'pro' / 'semi-pro' / 'amateur' (self-selected, admin can correct).
- `verified` (bool) + `verified_by` — admin-set. A team only shows the
  **✓ Verified Pro** badge once you've approved it. Self-claiming "pro" does
  nothing on its own; the badge is what teams trust.

Verification is admin-driven (reuses the existing approval pattern), and a
team attached to an official MPL league roster can be auto-flagged for your
review so you're not hunting. Unverified teams can still post — they just
appear as their self-declared tier without the badge.

**How pro teams find scrims — same board, tier-aware.** Pros use the exact
same board, plus two controls that make it work across tiers:
- Every listing carries the poster's tier (from `teams.tier`) and an
  **`open_to`** field — who they're willing to play: pro, amateur, or any.
- Browsers filter by **opponent tier** and a **"Verified only"** toggle.

So the flows you asked about all fall out of those two fields:
- **Pro wants serious sparring:** filter "Verified Pro only" → sees just other
  verified teams.
- **Pro wants to scrim amateurs sometimes:** posts a listing with
  `open_to = 'amateur'` (or 'any'). It surfaces to amateurs, who can contact
  them — but only because the pro opted in, so pros don't get spammed when
  they don't want it.
- **Amateur wants to play up:** filters the board for pro listings whose
  `open_to` includes amateurs, or posts `open_to = 'any'` hoping a pro bites.

A pro listing that's `open_to = 'pro'` simply won't show to amateur filters —
the opt-in is mutual and respects both sides.

## 5ab. Privacy & blind listings (scrim secrecy)

Teams treat who they scrim as classified — it signals prep and strategy. The
system is built so a team can use it without broadcasting anything.

**Blind listings (`anonymous = true`).** A team can post without revealing its
name. The card still shows the useful, non-identifying stuff — tier, region,
rank, format, availability, "✓ Verified Pro" if applicable — but the name
reads as "Verified Pro team (hidden)". Identity is revealed **only to the
specific team they choose to engage**, and only once the poster opts in
(replies / accepts). So they can fish for a scrim without the whole scene
seeing who's looking.

**Nobody can see who scrimmed whom.** A confirmed booking lives in
`scrim_bookings` with RLS that allows read **only to the two teams involved**
(plus admin, for moderation). There is no public "Team A vs Team B" anywhere —
not on the board, not on a profile, not in the calendar of any third team.
A filled listing just shows "filled", never by whom.

**No leaks through the side doors.** Contact details are shared only with a
team you actively engage, never on the public card. Phase 3 scrim history and
any reputation/no-show data are private to your own team; opponents are never
named publicly. Phase 3 "smart matching" suggestions are computed server-side
and shown only to you — they don't expose that team X is hunting scrims.

**Admin caveat (honest):** as the operator you can see listings and bookings
for moderation — that trust already exists for the rest of the platform. If a
team needs to be invisible even to ops, that's not something this (or any
hosted) tool can truthfully promise, so we don't pretend to.

## 5b. Agreement → calendar flow

The whole point of the calendar is: **once two teams agree, the scrim shows
up on both of their calendars automatically.** Here's the handshake:

1. Team B is interested in Team A's listing and **proposes a time** (date +
   time + format). This creates a `scrim_bookings` row, `status='proposed'`.
2. Team A gets a notification (badge now, email later) and **confirms** (or
   counter-proposes a new time, which just updates `scrim_at`).
3. On confirm, `status='confirmed'` — and it now appears on **both** teams'
   calendars. The source listing can auto-flip to `status='filled'`.
4. **Cancel / change of mind.** Either side can cancel a confirmed scrim with
   one tap (status='cancelled'). The moment they do, automatically and with no
   manual cleanup: it drops off **both** calendars, the other team is notified,
   the original listing **reopens** (status back to 'open') so it's discoverable
   again, and the cancelling team is immediately free to propose/accept with a
   different team. An optional one-line reason can be attached.
   - To keep cancelling honest (not punitive): the system warns before a
     last-minute cancel, and Phase 3 reputation quietly tracks frequent
     late cancels / no-shows so chronic flakers are visible — but a normal
     change of mind costs nothing.
   - A confirmed booking checks for a **time clash** before it locks, so you
     don't accidentally double-book the same slot with two teams.

RLS: a booking is readable and editable only by `team_a` and `team_b` (and
admin). Neither team can see other teams' bookings.

### Calendar UI
New **Calendar** tab on `/scrims` (and a compact "Upcoming scrims" widget on
the homepage/profile). Shows confirmed + proposed scrims:
- Month/week view, each booking a card: opponent, date/time in *their* local
  timezone, format, status pill (Proposed / Confirmed).
- Click → detail: confirm, counter-propose, cancel, contact, add-to-calendar.
- **Add to your real calendar:** an **"Add to Google Calendar"** link and a
  **downloadable `.ics`** file (works with Apple/Outlook/Google) generated
  client-side from the booking — no extra backend. This is how it lands on
  the calendar they already use, not just inside Warr.GG.
- Timezone-aware: each team sees the agreed time converted to their own tz,
  so a GMT+8 vs GMT+7 scrim shows correctly for both.
- **Scrim info panel:** clicking a booking opens its full info — both team
  names, date/time (local tz), format + games planned, each game's result as
  it's logged, status, contact/WhatsApp button, and your private notes/VODs.
  It updates live as games are logged or edited.
- **Editable team names (both sides):** the team that owns the booking can edit
  `team_a_name` and `team_b_name`. Your own name defaults from your team
  profile, but the opponent is frequently an amateur team with no Warr.GG
  account, so their name is a free-text field you set. Editing a name here
  keeps it consistent with the names on the logged Scout games for that scrim.
- **Private notes & VODs per booking:** on each scrim, a team can attach their
  own notes and VOD/replay links (`scrim_notes`). These are **visible only to
  the team that wrote them** — the opponent on the same scrim never sees them.
  So you can drop your replay link and prep notes right on the calendar entry
  without leaking footage. Each side keeps its own separate, private set.

## 5bc. Game format & partial scrims (games 1–3 survive a game-4 cancel)

**Flexible formats.** A scrim isn't only BO3/BO5/BO7. The format is two
fields: a `format_type` ('count' = play N games flat, 'bestof' = BO3/5/7,
'flexible' = "let's see how we feel") and `games_planned` (1–7). So "5 games
flat", "BO7", or "BO1" all express cleanly, and the listing/booking shows the
right label.

**A booking is the appointment; each game is its own logged record.** This is
the key to your game-4 question. The games aren't stored as one lump on the
booking — each game played gets logged individually into the existing **Scout
match log** (scrim type), tagged with the `booking_id`. The booking just
tracks `games_planned` and `games_played`.

**So when a team cancels game 4 after playing 1–3:**
- Games 1–3 are already saved as Scout matches — cancelling later games
  **does not touch them**. The data (drafts, results, per-lane stats) stays
  and still feeds Heroes/Meta/Enemy Draft Book like any other scrim.
- The booking flips to **`status='partial'`** with `games_played = 3`, not a
  hard 'cancelled'. The calendar shows "ended early — 3 of 5 played".
- 'cancelled' is reserved for a scrim that's called off with **zero** games
  played (that one fully drops off and reopens the listing, per §5b).
- Either team can also just **stop early by mutual done** → 'completed' with
  whatever count was played.

Net effect: you never lose collected data because someone bailed late, and the
partial result is still honestly recorded.

**Editing games anytime.** Because each game is an ordinary Scout match, you
can always go back and edit it — fix game 1's draft, correct a result, add a
missing stat — long after the scrim is over, exactly like editing any logged
match today. The booking status never freezes the data; 'partial' or
'completed' just describes the appointment, not the games. Normal Scout
permissions apply (only the team that logged it can edit/delete it), and the
recent save-context fix means editing game 1 keeps you right there in that
league/week instead of bouncing you away.

## 5c. Automation — what runs without you

The design is **status-driven**: the board, both calendars, and notifications
are just live views of two tables. You never sync anything by hand — change a
status and everything downstream updates itself. What's automatic:

- **Listing lifecycle:** confirm a scrim → its listing auto-flips to 'filled';
  cancel → auto-reopens to 'open'; 7-day **auto-expiry** quietly retires stale
  listings so the board is never full of dead posts.
- **Calendar sync:** both teams' calendars read live from `scrim_bookings`, so
  a confirm adds it and a cancel removes it on both sides instantly — no
  "update your calendar" step.
- **Notifications:** propose / confirm / counter-propose / cancel each fire an
  automatic alert (in-app badge now; email in Phase 2). Optional reminder
  before a confirmed scrim (Phase 3).
- **Auto-complete:** once `scrim_at` passes, a scheduled job flips the booking
  to 'completed' on its own — no one has to mark it done.
- **Calendar export:** "Add to Google Calendar" / `.ics` is generated on the
  fly from the booking; nothing to maintain.
- **Pro verification assist:** teams on an official MPL roster are
  auto-flagged for your review (you still click approve — that one stays
  manual on purpose, so the ✓ badge means something).
- **Matching (Phase 3):** opponent suggestions are computed automatically from
  rank + region + overlapping availability and shown only to you.

The only deliberately manual steps are the trust ones: approving a Verified
Pro badge, and acting on a report. Everything operational is hands-off.

## 5d. My data: view, sort, delete & performance report

This is where scrims pay off — the data has to be browsable and tell you if
the team is improving.

**View & manage (mostly already there):**
- Every scrim game is a Scout match, so it already shows in Scout / Stats /
  Heroes / Meta. Nothing extra to surface it.
- **Sort by week or month:** Scout already groups per week; we add a
  month grouping toggle (week / month) for a higher-level view.
- **Delete your data:** you can delete your own logged games — single game or
  bulk (e.g. "delete this whole scrim"). Owner-only, as today.
- **Export:** one-click CSV (and later PDF) of a date range — results, drafts,
  VOD links — so you can keep your own records or hand them to staff.

**Daily / weekly performance report — "is my team actually improving?"**
A **Team Report** that answers exactly that, available two ways:
- *On-demand dashboard* on the homepage/profile: win rate, recent form
  (last N games W/L streak), win rate by side (blue/red), most-played and
  best/worst-performing heroes, objective control (first turtle/lord/blood),
  and the **week-over-week / month-over-month trend** (are we trending up?).
  All scoped to your team, scrims + official, filterable by week or month.
- *Auto digest:* an optional scheduled summary (you choose daily or weekly)
  delivered in-app and by email — "Yesterday: 4 scrims, 3-1, blue-side WR up
  to 70%, Fanny pool looking shaky." Built on a scheduled Netlify/Supabase
  function. Daily makes sense for teams in heavy scrim blocks; weekly for
  lighter schedules, so it's a setting, not forced.

The report reuses the per-lane/team analytics you already built in the Scout
team report — it's mostly repackaging that into a trend-over-time view plus
the scheduled digest.

## 6. Anti-spam & moderation

- 3 open listings per user (DB trigger).
- 7-day auto-expiry; expired listings drop off the board automatically. A
  tiny scheduled cleanup (or a `where expires_at > now()` filter) keeps it tidy.
- **Report** button on every card → `scrim_reports`.
- Admin panel gets a **Scrim Finder** section: view reported/all listings,
  remove a listing, and ban an abuser (reuses existing ban flow).
- Rate-limit posting in the client + the per-user cap server-side.

## 7. Build phases

**Phase 1 — MVP (the launch):**
Migration 012, `scrims.html` board + post + my-listings, filters, external
contact, report + admin moderation, auto-expiry, nav + redirect. Free for all.

**Phase 2 — Agreement, calendar & chat:**
`scrim_bookings` + the propose/confirm handshake (section 5b), the Calendar
tab, timezone conversion, and **Add to Google Calendar / .ics export**. Plus
in-app chat: `scrim_threads` / `scrim_messages`, an inbox with unread badges,
Supabase Realtime for live messages, a "Message" button replacing external
contact for teams that prefer to stay in-app. (Chat and the booking handshake
ship together here since "agreeing" naturally happens in conversation.)

**Phase 3 — Smart matching & reputation (optional, later):**
Suggest opponents by matching region + rank + overlapping availability; a
completed booking pre-fills a Scout match log; team reputation (no-show flags
/ thumbs up). Possible Pro perks here: pinned/boosted listing, verified-team
badge. Optional: email/push reminders before a confirmed scrim.

## 8. What I need from you to start Phase 1

1. Approve "free for all + board-first" (or tell me to change it).
2. Confirm the contact methods to offer (proposed: Discord, Messenger, IGN,
   later in-app).
3. Confirm rank tiers / regions list (I can pull regions from the existing
   dynamic leagues + an "Amateur" bucket).

Once you approve, Phase 1 is roughly: write migration 012 → build
scrims.html → wire nav + redirect → admin moderation section → test with a
couple of fixture listings → commit.
