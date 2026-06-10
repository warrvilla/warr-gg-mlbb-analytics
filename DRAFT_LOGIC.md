# Warr.GG Draft Brain v2 — Design Spec (for review)

The core problem with the current AI: it scores every hero with one additive formula at every step. A real MPL coach asks a **different question at each draft slot**. This spec replaces "score everything, pick the max" with a **slot-aware decision pipeline**. It is engine-agnostic: it can be implemented as the new `localAI` (Path B) or as the structured prompt given to Claude (Path C) — same brain, two executors.

---

## 1. The pipeline (every turn, in this order)

```
LEGAL → NEEDS → INTENT → CANDIDATES → RANK → EXPLAIN
```

**LEGAL (hard filter, never bypassed).** Hero not picked/banned. Hero can play an open lane after flex resolution (see §5). Role caps respected. In ENEMY mode: hero is in the scouted team's pool (or league-common). If `picks_left == lanes_left`, every remaining pick must fill a distinct open lane — no exceptions, no fallback that skips this.

**NEEDS (board audit).** Open lanes, comp deficits (frontline, CC/setter, physical+magic damage split, damage curve), opponent's open lanes, opponent's visible win condition.

**INTENT (the slot question, §3).** Each slot maps to one primary intent and an explicit fallback ladder. The intent decides *which category of hero we're even considering*. This is the key change: a counter-pick can never "outvote" a lane requirement, because lane requirement is a filter, and intent decides the category before any scoring happens.

**CANDIDATES.** Only heroes matching the current intent. If the category is empty, drop to the next intent on the ladder — explicitly, with the reason recorded.

**RANK (small, bounded, within category only).** Tier + matchup WR + synergy WR + comfort/frequency + difficulty randomness. Scores never cross categories.

**EXPLAIN.** Reason = intent + evidence ("R5 counter slot: Khufra answers Fanny+Ling, can't be punished — their draft is locked").

---

## 2. Draft sequence (MPL tournament mode)

| Phase | Order | Slots |
|---|---|---|
| Ban 1 | B R B R B R | 3 bans each |
| Pick 1 | B1 · R1 R2 · B2 B3 · R3 | Blue first-picks |
| Ban 2 | R B R B | 2 bans each |
| Pick 2 | R4 · B4 B5 · R5 | Red last-picks |

Two structural truths the AI must internalize:

- **Blue's power = first pick.** Take the one hero that wins the meta lottery before anyone can ban it.
- **Red's power = R5 last pick.** The only pick in the game that can never be answered. A coach *saves a lane for it* — usually the lane where counter-matchup matters most (mid, jungle, or exp).

---

## 3. Slot intents (the heart of the spec)

### Ban phase 1 (the meta + comfort phase)

| Slot | Question the coach asks |
|---|---|
| Ban 1 | "What's broken this patch, or what is THIS opponent's best hero?" → MUST-BAN, else top comfort-deny from scout data |
| Ban 2 | "What hurts the comp I intend to draft?" → protect the planned first pick / identity |
| Ban 3 | "What's their next-best comfort or strongest combo piece?" → comfort-deny or combo-break |

Hard rule (keep from current code): never ban a hero whose only playable lanes are already filled on the opponent's side, and never ban into our own unfilled lane without a named strategic reason.

### Pick phase 1 (the security phase — NOT the counter phase)

| Slot | Intent | Logic |
|---|---|---|
| **B1** | SECURE | Highest ban-magnet meta hero that is **blind-safe**: 2+ lane flex preferred (hides comp), no widely-available hard counter, S/A tier. Never a hero that gets punished by 3 common picks. |
| **R1 R2** | SECURE ×2 | Take the two best remaining priorities. One may be a *cheap* counter to B1 only if it's also a meta hero we'd pick anyway (no pure-counter greed this early). Keep lane ambiguity if possible. |
| **B2 B3** | CORE + RESPOND | Now 2 enemy heroes visible. One pick completes our core (usually jungle or the identity carry), one responds to what R1/R2 revealed. Synergy pairs (proven scout combos) belong here. |
| **R3** | CLOSE SAFE | Fill the scarcest remaining lane — the one where the hero pool is thinnest after bans — so phase-2 bans can't strand us. A revealed counter to B2/B3 is acceptable if it also fills a needed lane. |

**Counter-timing principle:** the value of a counter-pick is discounted by how many picks the opponent has left to answer it. Early counter = revealed counter = invites the counter-counter. Counters are scored at ~40% weight in phase 1, full weight in phase 2, and dominant weight at R5/B5.

### Ban phase 2 (the surgical phase)

Both teams have 3 picks showing and 2 slots left. The question is no longer "what's strong" — it's:

1. **"What lanes do they have left, and what's their best remaining option there?"** → DENY. (Lane-targeted: if they still need mid + gold, only mid/gold heroes are ban candidates.)
2. **"What would dismantle OUR shown win condition?"** → PROTECT. If our comp is built around a carry, ban its hardest available counter *that fits one of their open lanes*.
3. Tie-break by scout phase-2 ban habits of the specific team.

A phase-2 ban on a hero the opponent has no lane for is a wasted ban — hard reject, already enforced, keep it.

### Pick phase 2 (the counter phase)

| Slot | Intent | Logic |
|---|---|---|
| **R4** | COUNTER | First real counter slot. Target the enemy's win condition revealed in phase 1. Must still fill an open lane. |
| **B4 B5** | FIX + COUNTER | Non-negotiable: these two picks must clear every comp deficit (frontline, CC, damage mix — §4). Within that constraint, maximize counter value vs the 4 visible enemy picks. One of the two should assume R5 will counter our weakest member — don't leave an obvious R5 target. |
| **R5** | EXECUTE | The unanswerable pick. Choose the hero with the best matchup spread vs all 5 enemy heroes in the saved lane. This is where scout counters, drafted-against data, and lane matchup WR get **full, dominant weight**. No safety discount — there is nothing left to be safe from. |

---

## 4. Comp identity & sanity rules

**Identity commit.** After our 2nd pick, classify the draft into one identity: pickoff, deathball/early rush, poke-siege, late-game protect, or split-pressure. From then on, candidates that *contradict* the identity (e.g., a late-game scaling pick in an early-rush comp) are filtered out of SECURE/CORE intents — not merely penalized. Identity can only be re-evaluated if bans gut the plan.

**Final-two sanity gates (hard, checked at B4/B5 and R4/R5):**
- At least one true frontline (tank or tanky fighter).
- At least one reliable engage/CC setter.
- Damage split: not 5 physical, not 5 magic — at least one real source of each.
- Damage curve: not all-late (we lose minutes 0–12), not all-early (we lose after 15).

If a sanity gate is failing and only one pick remains, the intent is forced to FIX regardless of slot table. Greedy counter that leaves no frontline = the exact "not coach-smart" feeling we're killing.

---

## 5. Lane & flex resolution (fixes the duplicate-lane bug class)

Maintain an explicit **lane ledger**: every picked hero is assigned a lane at pick time. Flex heroes get assigned to the *most probable* lane immediately but keep an "ambiguous" tag until the team's other picks force resolution. The LEGAL filter uses the ledger, not per-hero lane lists. A hero is pickable only if, after assigning it, a valid 1-per-lane assignment still exists for all remaining picks (simple bipartite check across ≤5 lanes — cheap). This makes the duplicate-lane bug structurally impossible instead of patched.

---

## 6. Data → pipeline map

Every signal we already collect has exactly **one entry point** in the pipeline. This is the discipline that prevents regression to additive soup: a signal influences the stage where a coach actually uses it, and nowhere else.

### Hero data (HEROES, TIER_LIST, META_SCORES)

| Signal | Source | Enters at | How |
|---|---|---|---|
| Lanes per hero | `getHeroLanesAB` + lane overrides | **LEGAL** | Feeds the lane ledger (§5). Nothing else ever reads lanes. |
| Role | `getHeroRole` | **NEEDS** | Comp deficit audit: frontline / setter / damage-split / damage-curve gates. |
| Tier (S/A/B/C) | scout tier cache, fallback `TIER_LIST` | **RANK** | Quality tie-break *within* the intent category. A C-tier counter still beats an S-tier non-counter at R5, because tier never crosses categories. |
| `mustban` / `highpick` flags | patch meta | **INTENT** | `mustban` = automatic Ban-1 candidate and B1 SECURE candidate (if it survives bans). `highpick` = ban-magnet score for the B1 "secure before banned" question. |
| Patch pick/ban rates | `META_SCORES` | **INTENT (B1, Ban 1)** | Defines "meta lottery": high BR% heroes are what blue first-pick exists to steal. |

### Scout match data (league-wide, from your logged matches)

| Signal | Source | Enters at | How |
|---|---|---|---|
| Scout tier (real WR in your league) | `_scoutTierCache` | **RANK** | Overrides patch tier — your league's reality beats the global meta sheet. |
| Counter matchups (X beats Y, with WR + sample) | `scoutCounters` / `fullCounterList` / learned counters | **INTENT (counter slots) + RANK** | Phase 1: 40% weight in RANK. R4: full weight. R5/B5: dominant — R5 literally ranks by matchup spread vs all 5 enemy heroes. Also drives PROTECT bans ("what counters our carry"). |
| Drafted-against (what real teams picked opposite hero Y) | `getDraftedAgainst` | **CANDIDATES (R4/R5)** | Generates the counter shortlist when direct counter data is thin — "teams that faced Ling picked these." Sample-weighted, ≥5 games = full trust. |
| Synergy combos (pair WR) | `scoutCombosAI` | **INTENT (B2/B3) + RANK** | B2/B3 CORE slots actively look for a proven partner to an already-picked hero. Elsewhere it's only a small RANK bonus. Carry-protect pairs (tank/support + your MM/mage) get priority at B4/B5 FIX. |
| League pick/ban frequency | `leaguePickFreq` / `leagueBanFreq` | **Priors** | Fallback when team-specific data is thin (current blend logic, unchanged). |

### Enemy team profile (ENEMY mode — the scouted opponent)

| Signal | Source | Enters at | How |
|---|---|---|---|
| Pick frequency per hero, per side | `epPickFreq` | **CANDIDATES** | When AI *plays as* the scouted team: its candidate pool is the team's actual pool. Never-picked heroes (thick data) are excluded — the AI drafts like *them*, not like a generic bot. |
| Phase 1 / Phase 2 pick patterns | `epPhase1/2`, `epPickPos` | **INTENT** | Slot intents get team-flavored: if the team always opens with Fanny, B1 SECURE shortlists Fanny first. Wrong-phase heroes drop out of the candidate list instead of getting a −60 nudge. |
| Side-specific cores (blue/red) | `blueSideCore` / `redSideCore` | **CANDIDATES** | Pool prior filtered by which side the AI drafts from. |
| Ban habits per phase | `epBanPhase1/2`, `epBans` | **INTENT (bans)** | Ban 1 mirrors their real first-ban habits; phase-2 deny bans tie-break by what this team historically removes. Also powers the *anti-ban first pick*: if the opponent commonly bans hero X in phase 2, locking X at B1 steals it. |
| Human tendencies (your own habits vs AI) | `getHumanTendencies` / combo threats | **INTENT (bans) + threat check** | COMFORT-DENY bans target your proven favorites; combo-break bans dismantle your high-WR pairs; the one-step threat check (§7) asks "does the human have a comfort counter left?" |

**The rule in one line:** lane data decides *legality*, role data decides *needs*, scout patterns decide *intent and candidates*, matchup/tier/synergy WR decide *rank* — and no signal is allowed to vote outside its stage.

## 7. Evidence hierarchy — how scoped data gets used

You hold data at four scopes: **team-on-side** (e.g., ECHO on blue side), **team**, **league** (MPL PH vs MPL ID vs MY/SG — different metas), and **overall** (all logged matches), plus the **patch meta sheet** as the zero-data floor. The current code blends two of these with hardcoded ratios and cliff thresholds. The coach brain replaces that with a backoff chain:

```
team-on-side → team → selected league → overall → patch meta
```

**Confidence-weighted blending.** Every signal (pick freq, counter WR, synergy WR, tier) is computed at each scope with its sample size, then blended by confidence: `weight = n / (n + k)`, where k is the signal's trust threshold (k≈5 for pick frequency, k≈8 for matchup WR — matchups need more games to trust). Whatever confidence a scope lacks falls through to the next scope down. No more `if (games < 5) use league` cliffs — a team with 3 games contributes exactly 3 games' worth of signal, smoothly.

**Cross-league discount.** When drafting against an MPL PH team, MPL ID data is evidence about the *patch*, not the *opponent*. League-mismatched data enters only the meta layer (tiers, ban-magnet status) at ~50% weight — never the opponent model (their habits, their pools).

**Recency decay.** Current-patch games count full; each patch back multiplies by ~0.6. A team's S-tier comfort from two patches ago is a memory, not a plan. The same decay on the meta layer is what makes the AI track *meta drift* instead of drafting last month's game.

**Scope answers different questions** — this matters more than the math:

| Question | Correct scope |
|---|---|
| "What will THIS team pick/ban?" | team-on-side → team only. League data never predicts a specific team's habits. |
| "What's strong right now?" | selected league → overall → patch sheet. |
| "Does X beat Y?" | overall first (matchups are mostly team-independent; maximize sample), league for meta-specific reads. |
| "Do X+Y synergize?" | overall, with a bonus if THIS team has proven the pair themselves. |
| "What gets banned in MPL PH?" | league. Ban culture is league-specific. |

## 8. Opponent model & prediction

- **ENEMY mode:** the scouted team's pick frequency, phase patterns, side cores, and ban habits act as **priors within the chosen intent's candidate pool** — never as a global score that can override lane or intent.
- **Predict-then-deny.** Before every one of OUR turns, run the opponent's own intent table (§3) against THEIR board with THEIR scout priors, producing their top-3 likely next moves. This generalizes the sandwich ban into a full layer: our bans pre-empt their predicted pick, our picks steal their predicted priority, and phase-2 bans target the lane the prediction says they fill next. The prediction surfaces in the reasoning: "ECHO's likely next: Ling > Fanny > Hayabusa — banning Ling."
- **One-step threat check** (hard/GM): before locking a pick — "after this, does the opponent have an open lane + unbanned S/A counter to our key carry?" If yes and this is our last chance to protect (next slot is theirs), prefer the candidate that closes that door.
- **BO5 series memory:** don't repeat a comp that just lost; expect respect-bans on heroes that just won; rotate the win condition.

## 9. The GM layer — elite coach, not good bot

These run on GM difficulty (and can power Coach Suggestions on the draft board):

**Ban equity.** A ban's value = (probability the opponent picks it, from §8 prediction) × (damage it would do to us, from matchup data vs our likely comp). Banning a 90%-presence hero this team never picks is zero equity. This one formula replaces most of the current ban-bonus zoo.

**Win-condition ledger.** From the identity commit (§4) onward, the draft carries a named win condition ("protect Beatrix into late," "lord-rush windows," "pickoff chains on Kadita+Franco"). Every later pick/ban must either advance it or fix a sanity gate — the reasoning names which. The finished draft is evaluated as OUR win condition vs THEIRS: who owns which game-minute windows, and whether our comp denies their window (their deathball spikes at 8–14min → we must not be weakest there).

**Full-board endgame evaluation.** At R5/B5, candidates rank by a 5v5 matrix: lane-matchup WR + role interactions (their assassin vs our backline protection, our engage vs their disengage) across the whole board — not hero-vs-hero in isolation.

**Flex ambiguity as a weapon.** Track how many lane assignments the *opponent* must respect for our shown picks. Early picks keeping 2+ live interpretations (Chou exp/roam, Selena jungle/roam) force their bans and counters to split. Bonus at B1–B3, zero once our lanes are forced anyway.

**Two-step lookahead at pivot slots.** At B2/B3 and the phase-2 bans, simulate: our candidate → their predicted best response (§8) → our best follow-up, and score the *end state* with the comp evaluator — not the immediate pick. Top-5 candidates only; cheap, and catches "great pick, terrible position" traps like leaving an obvious R5 target.

**Anti-meta reads.** When the opponent's profile is rigid (high comp repeat-rate in scout data), deliberately draft the counter-identity even at small tier cost: rigid deathball → poke-siege that denies their engage. Identity counter-triangle: pickoff beats poke, poke beats deathball, deathball beats pickoff; early-rush beats late-game-protect unless their early lanes win blind.

---

## 10. Difficulty mapping

| | Normal | Hard | GM |
|---|---|---|---|
| Randomness in RANK | high (±32) | low (±12) | minimal (±4) |
| Counter-timing discipline | sometimes counters early | follows spec | follows spec |
| One-step threat check | off | on | on |
| Identity commit | loose | strict | strict |
| GM layer (§9: ban equity, prediction, lookahead, win-condition ledger, anti-meta) | off | prediction only | full |
| Sanity gates | on (always) | on | on |

Sanity gates and the LEGAL filter are **never** relaxed by difficulty — a Normal AI can be impulsive, it cannot be illegal.

---

## 11. Implementation paths (decided after review)

- **Path B:** this spec becomes the new `localAI` — roughly 6 small functions (legal, needs, intent table, candidates, rank, explain) replacing the ~1000-line additive block. All existing data sources (scout tiers, counters, synergies, drafted-against, pick freq, archetypes) are reused, just relocated into the stage where a coach actually uses them.
- **Path C:** this spec becomes the system prompt skeleton for `claudeAI` — the slot table, board state, needs audit, and candidate shortlist (top ~15 legal heroes with their data) are serialized into the prompt; Claude returns pick + reasoning. `localAI` v2 stays as the no-API fallback.
- **Recommended:** B for the engine, then C layered on top for GM difficulty — Claude reasons best when the prompt already did the legal/needs work for it.

---

*Review notes welcome — especially §3 slot intents and §4 identity rules, since those encode the actual coaching judgment.*
