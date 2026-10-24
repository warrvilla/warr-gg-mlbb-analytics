// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — Heimerdinger's data tools
//
// Claude (via /api/claude, purpose 'chat') can call these tools to query the
// site's data itself — any team, player, hero, league, season, stage, side,
// game number or patch — over several steps, instead of answering only from
// the fixed data pack. Tools run HERE, in the browser, over exactly the data
// this user can already see (official matches + their own scrims, via RLS),
// so nothing private is ever sent that the page couldn't already show.
//
//   HeimerTools.defs                 tool definitions for the API
//   HeimerTools.run(name, input, C)  → Promise<string> (compact text result)
//   HeimerTools.describe(name, input)  short "what I'm checking" line for the UI
//
// C = { usable, locked(team), cur{league:season}, myTeam, heroes[] }
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const T = {};
  const nm = p => String((p && (p.name || p)) || '').trim();
  const pct = x => Math.round(x * 100);
  const other = s => (s === 'blue' ? 'red' : 'blue');
  const sideOf = (m, t) => (m.blueTeam === t ? 'blue' : m.redTeam === t ? 'red' : null);
  const involves = (m, t) => m.blueTeam === t || m.redTeam === t;
  const isScrim = m => (m.league || '') === 'Scrims';
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wl = (w, g) => `${w}-${g - w}`;
  const shrink = (w, n, base, k) => (w + base * k) / (n + k);
  const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.gameNum) || 0) - (Number(a.gameNum) || 0);
  const MAX = 7500;
  const cap = s => (s.length > MAX ? s.slice(0, MAX) + '\n…(trimmed — narrow the filters for more)' : s);
  const fail = msg => Object.assign(new Error(msg), { tool: true });
  let C = null;

  // ── Lookups ───────────────────────────────────────────────────────────
  function leagues() {
    const last = {};
    C.usable.forEach(m => { if (isScrim(m) || !m.league) return; last[m.league] = (m.date || '') > (last[m.league] || '') ? (m.date || '') : (last[m.league] || ''); });
    return Object.keys(last).sort((a, b) => (last[b] || '').localeCompare(last[a] || ''));
  }
  const seasonsOf = lg => [...new Set(C.usable.filter(m => m.league === lg).map(m => (m.season || '').trim()).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const activeSeason = lg => { const ss = seasonsOf(lg); return C.cur[lg] && ss.includes(C.cur[lg]) ? C.cur[lg] : (ss[0] || ''); };
  function findLeague(q) {
    const n = norm(q), L = leagues();
    return L.find(l => norm(l) === n) || L.find(l => norm(l).includes(n)) || L.find(l => n.includes(norm(l))) || '';
  }
  function matchSeason(ss, q) {
    const n = norm(q), d = (String(q).match(/\d+/) || [])[0];
    return ss.find(s => norm(s) === n) || (d ? ss.find(s => (s.match(/\d+/) || [])[0] === d) : '') || '';
  }
  const visibleTeams = () => [...new Set(C.usable.flatMap(m => [m.blueTeam, m.redTeam]))].filter(t => !C.locked(t));
  function teamLeague(t) {
    const g = C.usable.filter(m => involves(m, t)).sort(byDateDesc);
    return (g.find(m => !isScrim(m)) || g[0] || {}).league || '';
  }
  function findTeam(q, need) {
    if (!q) { if (need) throw fail('A team name is required.'); return ''; }
    const s = String(q).trim();
    if (/^(we|us|my team|our team|mine)$/i.test(s) && C.myTeam) return C.myTeam;
    const all = [...new Set(C.usable.flatMap(m => [m.blueTeam, m.redTeam]))];
    const exact = all.find(t => t.toLowerCase() === s.toLowerCase()) || all.find(t => norm(t) === norm(s));
    const myLg = C.myTeam ? teamLeague(C.myTeam) : '';
    const hit = exact || (root.WIntel.findTeams(s, all, t => (t === C.myTeam ? 3 : 0) + (myLg && teamLeague(t) === myLg ? 1 : 0))[0]) || all.find(t => norm(t).includes(norm(s)) && norm(s).length >= 3);
    if (!hit) throw fail(`No team matches "${s}". Use list_data to see teams.`);
    if (C.locked(hit)) throw fail(`${hit} is a private team — its data is locked for this user. Say so; don't guess.`);
    return hit;
  }
  function allHeroes() {
    const s = new Set(C.heroes || []);
    C.usable.forEach(m => ['blue', 'red'].forEach(sd => { (m[sd + 'Picks'] || []).forEach(p => s.add(nm(p))); (m[sd + 'Bans'] || []).forEach(b => s.add(nm(b))); }));
    s.delete(''); return [...s];
  }
  const HERO_ALIAS = { yss: 'Yi Sun-shin', popol: 'Popol and Kupa', kupa: 'Popol and Kupa', xborg: 'X.Borg', lapu: 'Lapu-Lapu', lapulapu: 'Lapu-Lapu', yz: 'Yu Zhong', cc: 'Chang\'e', change: 'Chang\'e', bb: 'Benedetta', lylia: 'Lylia', nathan: 'Nathan' };
  function findHero(q, need) {
    if (!q) { if (need) throw fail('A hero name is required.'); return ''; }
    const n = norm(q), H = allHeroes();
    const al = HERO_ALIAS[n];
    const hit = H.find(h => norm(h) === n) || (al && H.find(h => norm(h) === norm(al))) || (n.length >= 3 ? H.filter(h => norm(h).startsWith(n))[0] || H.filter(h => norm(h).includes(n))[0] : '');
    if (!hit) throw fail(`No hero matches "${q}".`);
    return hit;
  }
  function allPlayers() {
    const P = {};
    C.usable.forEach(m => ['blue', 'red'].forEach(sd => (m[sd + 'Picks'] || []).forEach(p => {
      const pl = p && p.player; if (!pl) return; const k = norm(pl);
      const x = P[k] || (P[k] = { name: pl, teams: {} }); const t = sd === 'blue' ? m.blueTeam : m.redTeam; x.teams[t] = (x.teams[t] || 0) + 1;
    })));
    return P;
  }

  // Resolve league / season / stage / patch / dates into a pool of games.
  function scope(a, team) {
    a = a || {};
    let lg = '';
    const allLg = /^(all|any|every|all leagues)$/i.test(String(a.league || '').trim());
    if (a.league && !allLg) { lg = findLeague(a.league); if (!lg) throw fail(`Unknown league "${a.league}". Leagues: ${leagues().join(', ')}`); }
    else if (!allLg) lg = team ? teamLeague(team) : ((C.myTeam && teamLeague(C.myTeam)) || leagues()[0] || '');
    const sq = String(a.season || '').trim().toLowerCase();
    let seasons = null;
    if (lg) {
      const ss = seasonsOf(lg);
      if (sq === 'all') seasons = null;
      else if (!sq || /^(current|active|latest|this season|now)$/.test(sq)) {
        const cur = activeSeason(lg); seasons = cur ? [cur] : null;
        if (team && cur) {
          const n = C.usable.filter(m => m.league === lg && (m.season || '').trim() === cur && involves(m, team)).length;
          const prev = ss[ss.indexOf(cur) + 1];
          if (n < 8 && prev) seasons.push(prev);
        }
      } else {
        const hit = matchSeason(ss, a.season);
        if (!hit) throw fail(`No season "${a.season}" in ${lg}. Seasons: ${ss.join(', ') || 'none'}`);
        seasons = [hit];
      }
    } else if (sq && !/^(all|current|active|latest)$/.test(sq)) seasons = [String(a.season).trim()];
    const scr = !!a.include_scrims;
    let pool = C.usable.filter(m => {
      if (isScrim(m)) return scr;
      if (lg && m.league !== lg) return false;
      if (seasons && !seasons.includes((m.season || '').trim())) return false;
      return true;
    });
    if (a.stage) {
      const st = String(a.stage).trim();
      const grp = /^play-?offs?$|^knock-?outs?$/i.test(st) ? 'Playoffs' : /^reg/i.test(st) ? 'Regular Season' : /^group/i.test(st) ? 'Group Stage' : '';
      pool = pool.filter(m => isScrim(m) || (grp ? root.WIntel.stageGroup(m) === grp : (norm(m.stage) + '|' + norm(m.week)).includes(norm(st))));
    }
    if (a.patch) pool = pool.filter(m => norm(m.patch).startsWith(norm(a.patch)));
    if (a.date_from) pool = pool.filter(m => (m.date || '') >= a.date_from);
    if (a.date_to) pool = pool.filter(m => (m.date || '').slice(0, 10) <= a.date_to);
    const label = [lg || 'all leagues', seasons ? seasons.join(' + ') : (lg ? 'all seasons' : ''), a.stage ? String(a.stage) : '', a.patch ? 'patch ' + a.patch : '',
      a.date_from || a.date_to ? `${a.date_from || '…'} to ${a.date_to || 'now'}` : '', scr ? 'incl. your own scrims' : ''].filter(Boolean).join(' · ');
    return { lg, seasons, pool, label };
  }
  const visible = m => !C.locked(m.blueTeam) && !C.locked(m.redTeam);
  const LANE_SEQ = 'EXP,Jungle,Mid,Gold,Roam';

  function gameLine(m) {
    const W = root.WIntel, d = W.mins(m.duration);
    const head = [(m.date || '').slice(0, 10), isScrim(m) ? 'YOUR SCRIM' : [m.league, m.season].filter(Boolean).join(' '), isScrim(m) ? '' : (m.stage || W.stageGroup(m)), m.week,
      m.seriesFormat ? `${m.seriesFormat} G${m.gameNum || 1}` : '', m.patch ? 'patch ' + m.patch : '', d ? Math.round(d) + 'm' : '', m.map ? 'map ' + m.map : ''].filter(Boolean).join(' · ');
    const side = s => {
      const t = s === 'blue' ? m.blueTeam : m.redTeam, b = (m[s + 'Bans'] || []).map(nm), p = m[s + 'Picks'] || [];
      const ordered = p.length === 5 && p.map(x => x && x.lane).join(',') !== LANE_SEQ;
      const pk = p.map((x, i) => `${ordered ? W.slotLabel(s, i) + ' ' : ''}${nm(x)}${x && (x.lane || x.player) ? '(' + [x.lane, x.player].filter(Boolean).join(' ') + ')' : ''}`).join(', ');
      return `${s.toUpperCase()} ${t}${m.winner === s ? ' (WIN)' : ''} — bans ${(b.slice(0, 3).join(', ') || '—') + (b.length > 3 ? ' / P2: ' + b.slice(3).join(', ') : '')} — picks${ordered ? '' : ' (lane order)'} ${pk || '—'}`;
    };
    const ex = [], ob = m.objectives || {};
    if (Array.isArray(ob.turtle) && ob.turtle.filter(Boolean).length) ex.push('turtles ' + ob.turtle.filter(Boolean).join('/'));
    if (Array.isArray(ob.lord) && ob.lord.filter(Boolean).length) ex.push('lords ' + ob.lord.filter(Boolean).join('/'));
    if (m.firstBlood) ex.push('first blood ' + m.firstBlood);
    if (m.towers && m.towers.blue != null && m.towers.red != null) ex.push(`towers B${m.towers.blue}-R${m.towers.red}`);
    if (m.phaseWinners) ex.push('phases ' + ['early', 'mid', 'late'].map(k => `${k} ${m.phaseWinners[k] || '?'}`).join(', '));
    return `${head}\n  ${side('blue')}\n  ${side('red')}${ex.length ? '\n  ' + ex.join(', ') : ''}`;
  }
  const count = (arr) => { const o = {}; arr.forEach(([k, win]) => { if (!k) return; const x = o[k] || (o[k] = { g: 0, w: 0 }); x.g++; if (win) x.w++; }); return o; };
  const topTxt = (o, n, min) => Object.entries(o).filter(([, v]) => v.g >= (min || 1)).sort((a, b) => b[1].g - a[1].g || b[1].w - a[1].w).slice(0, n).map(([h, v]) => `${h} ${v.g} (${wl(v.w, v.g)})`).join(', ');

  // ── Extra site data (loaded once, on first use) ─────────────────────────
  const X = { p: null };
  function extras() {
    if (X.p) return X.p;
    const WDB = root.WDB || {};
    const safe = (f) => Promise.resolve().then(f).catch(() => null);
    X.p = Promise.all([
      safe(() => WDB.loadTeamMeta && WDB.loadTeamMeta()),
      safe(() => WDB.loadTeamRoster && WDB.loadTeamRoster()),
      safe(() => WDB.loadHeroRelations && WDB.loadHeroRelations()),
      safe(async () => {
        if (typeof _sbClient === 'undefined') return null;   // eslint-disable-line no-undef
        const { data } = await _sbClient.from('top100_snapshots').select('scraped_at,total_players,heroes').order('scraped_at', { ascending: false }).limit(1);   // eslint-disable-line no-undef
        return (data && data[0]) || null;
      }),
      safe(() => JSON.parse(localStorage.getItem('warr_patch_meta') || '[]')),
    ]).then(([meta, roster, rel, top100, patches]) => { X.rel = rel || {}; return { meta: meta || {}, roster: roster || [], rel: rel || {}, top100, patches: Array.isArray(patches) ? patches : [] }; });
    return X.p;
  }
  T._resetExtras = () => { X.p = null; };

  // ── Tool definitions ──────────────────────────────────────────────────
  const S = (d) => ({ type: 'string', description: d });
  const common = {
    league: S('League name, e.g. "MPL PH", "MPL ID"; "all" = every league. Default: the team\'s league (else the user\'s).'),
    season: S('Season, e.g. "S16". "current" (default) = the active season; "all" = every season.'),
    stage: S('"Regular Season", "Playoffs", "Group Stage", or any stage/week text like "Grand Final", "Upper Bracket", "Week 3".'),
  };
  T.defs = [
    { name: 'list_data', description: 'What data exists: leagues, seasons (active one marked), stages, patches, game counts and teams. Call first if unsure what a name refers to or what is covered.',
      input_schema: { type: 'object', properties: { league: S('Optional — detail one league (seasons, stages, teams with records).') } } },
    { name: 'query_games', description: 'Find games with any filter combination and get a summary (record, sides, most picked/banned) plus the game list with full draft (bans by phase, picks in draft slot order B1..B5/R1..R5 with lanes and players), objectives and duration. Use for specific questions: "Falcons blue-side playoff games", "games where Onic first-picked Fanny", "game 1s", "games on patch 1.9".',
      input_schema: { type: 'object', properties: {
        team: S('Team the stats are about (their perspective for side/result/hero filters).'),
        opponent: S('Only games vs this team.'),
        ...common,
        side: { type: 'string', enum: ['blue', 'red'], description: 'Team\'s side.' },
        result: { type: 'string', enum: ['win', 'loss'], description: 'Team\'s result.' },
        game_number: { type: 'integer', description: 'Game number within the series (1 = game 1).' },
        format: S('Series format: BO3, BO5, BO7.'),
        hero: S('Only games where this hero was picked.'),
        hero_by: { type: 'string', enum: ['team', 'opponent', 'either'], description: 'Who picked `hero` (default: team if team is set, else either).' },
        first_pick: S('Only games where this hero was the team\'s first pick (B1 on blue, R1/R2 on red).'),
        banned_hero: S('Only games where this hero was banned (by either side).'),
        player: S('Only games this player (IGN) played.'),
        patch: S('Game patch, e.g. "1.9.2" (prefix match).'),
        date_from: S('YYYY-MM-DD'), date_to: S('YYYY-MM-DD'),
        include_scrims: { type: 'boolean', description: 'Also include the user\'s OWN scrims (never other teams\').' },
        limit: { type: 'integer', description: 'Games to list (default 10, max 25). 0 = summary only.' },
      } } },
    { name: 'team_report', description: 'Full scouting profile of one team: record by stage, series results, opponent-adjusted strength, side records, hero pool by lane and player, signature heroes, ban impact (their WR when a hero is open vs banned), heroes that beat them, tempo (duration, first blood/turtle, lords), data-backed levers to beat them, admin coach notes / win condition, and roster.',
      input_schema: { type: 'object', properties: { team: S('Team name.'), ...common, side: { type: 'string', enum: ['blue', 'red'] } }, required: ['team'] } },
    { name: 'draft_tendencies', description: 'Draft-order intelligence for one team: first picks (B1 on blue, R1-R2 on red) and the lanes they secure first, what they first-pick when their favourite is banned, last picks (R5 counter slot), lane pick order, phase 1 vs phase 2 bans by side, what opponents ban against them, flex picks, and series behaviour (game 1, after a loss, after a win, deciders; whether they adjust bans/heroes after losing).',
      input_schema: { type: 'object', properties: { team: S('Team name.'), ...common, side: { type: 'string', enum: ['blue', 'red'] } }, required: ['team'] } },
    { name: 'matchup', description: 'Team A vs team B: opponent-adjusted win probability (per game, BO3, BO5, BO7), head-to-head games and series across all seasons with drafts, side records, each team\'s highest-impact bans and whether the other side tends to ban them, contested heroes and first-pick clashes.',
      input_schema: { type: 'object', properties: { team_a: S('First team (usually the user\'s).'), team_b: S('Opponent.'), ...common }, required: ['team_a', 'team_b'] } },
    { name: 'hero_report', description: 'One hero in a scope: picks, bans, presence, win rate, lanes, which teams and players play it (with records), draft slot it is taken in, best and worst matchups, best duo partners, record by patch, the site\'s curated counters/synergies, solo-queue Top 100 stats and patch tier. Optional vs_hero / with_hero for a head-to-head or duo record.',
      input_schema: { type: 'object', properties: { hero: S('Hero name.'), ...common, patch: S('Patch prefix.'), vs_hero: S('Record of `hero` against this hero (opposite teams).'), with_hero: S('Record of `hero` with this hero on the same team.') }, required: ['hero'] } },
    { name: 'player_report', description: 'One player (IGN): team(s), lanes, hero pool with records and KDA where logged, most recent heroes, roster info.',
      input_schema: { type: 'object', properties: { player: S('Player IGN.'), ...common }, required: ['player'] } },
    { name: 'evaluate_draft', description: 'Rate a full or partial draft with Warr.GG\'s draft model (trained in the browser on every logged official game, back-tested on the newest games). Returns the win chance for each side, how much is team strength vs the draft itself, the factors behind it in win-% points (heroes, lane matchups, duos, comp identity and how comps fare into each other, frontline/damage mix) with sample sizes, and — for a partial draft — the best next picks by lane. If a team is named it also predicts what that team will likely do next from its real habits. Use for "is this draft good?", "what should we pick now?", "who wins this draft?".',
      input_schema: { type: 'object', properties: {
        blue_team: S('Blue team (optional).'), red_team: S('Red team (optional).'),
        blue_picks: { type: 'array', items: { type: 'object', properties: { hero: { type: 'string' }, lane: { type: 'string', enum: ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'] } }, required: ['hero'] }, description: 'Blue picks in draft order; lane optional (inferred).' },
        red_picks: { type: 'array', items: { type: 'object', properties: { hero: { type: 'string' }, lane: { type: 'string', enum: ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'] } }, required: ['hero'] } },
        blue_bans: { type: 'array', items: { type: 'string' } }, red_bans: { type: 'array', items: { type: 'string' } },
        suggest_for: { type: 'string', enum: ['blue', 'red', 'both', 'none'], description: 'Whose next-pick suggestions to list (default: whoever picks next).' },
      } } },
    { name: 'predict_draft', description: 'Replicate how a specific team drafts: given the draft so far, what will THEY most likely pick or ban next (from their real slot-by-slot habits, what they do when their favourites are gone, which lane they usually fill at that slot), with reasons — plus what the draft model says would be best for them, so you can see where habit and value differ. With an empty draft it predicts their opening bans / first pick.',
      input_schema: { type: 'object', properties: {
        team: S('The team whose next move to predict.'), side: { type: 'string', enum: ['blue', 'red'], description: 'Their side (default: red if unknown).' },
        kind: { type: 'string', enum: ['pick', 'ban'], description: 'Default: inferred from the draft order.' },
        opponent: S('Optional opponent team.'),
        blue_picks: { type: 'array', items: { type: 'object', properties: { hero: { type: 'string' }, lane: { type: 'string' } }, required: ['hero'] } },
        red_picks: { type: 'array', items: { type: 'object', properties: { hero: { type: 'string' }, lane: { type: 'string' } }, required: ['hero'] } },
        blue_bans: { type: 'array', items: { type: 'string' } }, red_bans: { type: 'array', items: { type: 'string' } },
        ...common,
      }, required: ['team'] } },
    { name: 'ban_plan', description: 'THE tool for any ban question ("what should we ban vs X", "phase 2 bans", "who to ban first"). Ranks bans against an opponent the way a coach does: meta power (how often pros ban/pick the hero this season, recent trend, patch/tier lists — OP heroes get banned even when their win rate is hidden by bans), the opponent\'s comfort and ban impact (their win rate when it\'s open vs banned), their first-pick priorities, how thin each lane\'s hero pool is (ban both of a one-trick\'s heroes), threats to the user\'s team, and the draft model\'s value — weighted by how likely the opponent is to pick each hero. Splits phase 1 vs phase 2 (aimed at the lanes they still need), flags contested heroes to pick instead, and lists what they will likely ban against you.',
      input_schema: { type: 'object', properties: {
        opponent: S('The team you are banning against.'), team: S('Your team (default: the user\'s team).'),
        side: { type: 'string', enum: ['blue', 'red'], description: 'YOUR side, if known.' },
        phase: { type: 'integer', enum: [1, 2], description: 'Ban phase (default: inferred from the draft).' },
        blue_picks: { type: 'array', items: { type: 'object', properties: { hero: { type: 'string' }, lane: { type: 'string' } }, required: ['hero'] } },
        red_picks: { type: 'array', items: { type: 'object', properties: { hero: { type: 'string' }, lane: { type: 'string' } }, required: ['hero'] } },
        blue_bans: { type: 'array', items: { type: 'string' } }, red_bans: { type: 'array', items: { type: 'string' } },
        map: S('Battle map, if known.'),
        series: { type: 'array', description: 'Earlier games of THIS series, oldest first.', items: { type: 'object', properties: { their_picks: { type: 'array', items: { type: 'string' } }, our_picks: { type: 'array', items: { type: 'string' } }, we_won: { type: 'boolean' } } } },
        ...common,
      }, required: ['opponent'] } },
    { name: 'team_brain', description: 'HOW A TEAM THINKS when drafting — learned from every pick and ban they made against the alternatives that were open (league-wide expert brain over all logged drafts). Returns why they pick (power/priority, comfort, player comfort, counter, synergy, comp fix, deny, flex/hide, lane plan, team habit, pocket picks) and why they ban (meta, target, protect, role, lane-lock), each vs the league average; philosophy scores; how predictable they are; the draft types (comp archetypes found in the data) they run; and their latest draft explained step by step. Use for "how does X draft", "what is X\'s style / thought process", "what does X do differently".',
      input_schema: { type: 'object', properties: { team: S('Team name.') }, required: ['team'] } },
    { name: 'explain_game', description: 'Explain one real game\'s draft decision by decision (all 20 bans and picks): the reason the brain attributes to each and how expected it was (its rank among the options). Finds the latest game for the team (optionally vs an opponent or on a date).',
      input_schema: { type: 'object', properties: { team: S('Team name.'), opponent: S('Optional opponent.'), date: S('Optional YYYY-MM-DD.'), game_number: { type: 'integer' } }, required: ['team'] } },
    { name: 'patch_report', description: 'THE tool for the current patch and hero kits. Without a hero: who is strongest right now (patch power ranking with tiers) from the patch notes (exact old → new numbers, Liquipedia), pro picks/bans/wins on this patch vs the previous one, the draft model and solo-queue Top 100 — plus everything buffed, nerfed or revamped this patch and the risers/fallers. With a hero: its full kit (each skill: type, cooldowns, damage numbers, CC and durations), its patch-change history and where it ranks now. Optional lane filter. Use for "who is OP / strongest this patch", "what got buffed/nerfed", "tier list", "what does X do", "X cooldown", "did X get nerfed".',
      input_schema: { type: 'object', properties: { hero: S('Optional hero for kit + change history.'), lane: { type: 'string', enum: ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'] }, top: { type: 'integer', description: 'How many heroes to rank (default 15).' } } } },
    { name: 'league_report', description: 'A league/season overview: regular-season standings (series record, then game difference), playoff series, opponent-adjusted strength ranking, hero meta (presence, picks, bans, WR), most common first picks and phase-1 bans, blue-side win rate, average game time.',
      input_schema: { type: 'object', properties: { ...common } } },
  ];

  T.describe = function (name, a, ctx) {
    a = { ...(a || {}) };
    if (ctx) C = ctx;
    const tn = x => { try { return x && C ? findTeam(x) : x; } catch (_) { return x; } };
    const hn = x => { try { return x && C ? findHero(x) : x; } catch (_) { return x; } };
    ['team', 'opponent', 'team_a', 'team_b'].forEach(k => { if (a[k]) a[k] = tn(a[k]); });
    ['hero', 'vs_hero', 'with_hero'].forEach(k => { if (a[k]) a[k] = hn(a[k]); });
    const sc = [a.stage, a.season && a.season !== 'current' ? a.season : '', a.league].filter(Boolean).join(' ');
    const w = sc ? ` (${sc})` : '';
    switch (name) {
      case 'list_data': return `Checking what data we have${a.league ? ' for ' + a.league : ''}…`;
      case 'query_games': return `Pulling ${a.team ? a.team + "'s " : ''}games${a.opponent ? ' vs ' + a.opponent : ''}${a.hero ? ' with ' + a.hero : ''}${a.side ? ' on ' + a.side : ''}${w}…`;
      case 'team_report': return `Scouting ${a.team}${w}…`;
      case 'draft_tendencies': return `Reading ${a.team}'s draft order${w}…`;
      case 'matchup': return `Comparing ${a.team_a} vs ${a.team_b}…`;
      case 'hero_report': return `Looking up ${a.hero}${a.vs_hero ? ' vs ' + a.vs_hero : ''}${a.with_hero ? ' with ' + a.with_hero : ''}${w}…`;
      case 'player_report': return `Checking ${a.player}'s hero pool…`;
      case 'league_report': return `Reading the ${a.league || 'league'} table${w}…`;
      case 'patch_report': return a.hero ? `Reading ${a.hero}'s kit and patch history…` : `Ranking heroes on the current patch${a.lane ? ' (' + a.lane + ')' : ''}…`;
      case 'team_brain': return `Learning how ${a.team} drafts…`;
      case 'explain_game': return `Explaining ${a.team}'s draft${a.opponent ? ' vs ' + a.opponent : ''}…`;
      case 'ban_plan': return `Building a ban plan vs ${a.opponent}${w}…`;
      case 'evaluate_draft': return `Running the draft model${a.blue_team && a.red_team ? ` on ${a.blue_team} vs ${a.red_team}` : ''}…`;
      case 'predict_draft': return `Predicting ${a.team}'s next ${a.kind || 'move'}…`;
      default: return 'Checking the data…';
    }
  };

  // ── Implementations ───────────────────────────────────────────────────
  const IMPL = {};

  IMPL.list_data = async (a) => {
    const W = root.WIntel, out = [];
    if (a.league) {
      const lg = findLeague(a.league); if (!lg) throw fail(`Unknown league "${a.league}". Leagues: ${leagues().join(', ')}`);
      const act = activeSeason(lg);
      seasonsOf(lg).forEach(se => {
        const ms = C.usable.filter(m => m.league === lg && (m.season || '').trim() === se);
        const dates = ms.map(m => m.date || '').filter(Boolean).sort();
        const st = {}; ms.forEach(m => { const k = W.stageGroup(m); st[k] = (st[k] || 0) + 1; });
        const pt = [...new Set(ms.map(m => m.patch).filter(Boolean))];
        out.push(`${lg} ${se}${se === act ? ' (ACTIVE)' : ''}: ${ms.length} games, ${dates[0] || '?'} to ${dates[dates.length - 1] || '?'} · stages: ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ')}${pt.length ? ' · patches: ' + pt.join(', ') : ''}`);
      });
      const pool = C.usable.filter(m => m.league === lg && (m.season || '').trim() === act);
      const rec = {}; pool.forEach(m => ['blue', 'red'].forEach(s => { const t = s === 'blue' ? m.blueTeam : m.redTeam; const x = rec[t] || (rec[t] = { g: 0, w: 0 }); x.g++; if (m.winner === s) x.w++; }));
      out.push(`Teams in ${lg} ${act}: ${Object.entries(rec).sort((x, y) => y[1].w / y[1].g - x[1].w / x[1].g).map(([t, v]) => `${t}${C.locked(t) ? ' [private]' : ''} ${wl(v.w, v.g)}`).join(', ')}`);
    } else {
      leagues().forEach(lg => {
        const ss = seasonsOf(lg), act = activeSeason(lg);
        out.push(`${lg}: ${ss.map(s => `${s}${s === act ? '*' : ''} (${C.usable.filter(m => m.league === lg && (m.season || '').trim() === s).length}g)`).join(', ')}`);
      });
      out.push('(* = active season)');
      const scr = C.usable.filter(isScrim).length;
      out.push(`User's own scrims: ${scr} games${scr ? ' (use include_scrims)' : ''}.`);
      const x = await extras();
      out.push(`Other site data: coach notes for ${Object.values(x.meta).filter(v => v && (v.coachNotes || v.winCondition || Object.keys(v.leagueMeta || {}).length)).length} teams, ${x.roster.length} roster entries, curated counters/synergies for ${Object.keys(x.rel).length} heroes, solo-queue Top 100 snapshot ${x.top100 ? x.top100.scraped_at : 'none'}, patch tier lists: ${x.patches.map(p => p.name).filter(Boolean).join(', ') || 'none'}.`);
    }
    if (C.myTeam) out.push(`User's team: ${C.myTeam}.`);
    return out.join('\n');
  };

  IMPL.query_games = async (a) => {
    const team = findTeam(a.team), opp = findTeam(a.opponent);
    const sc = scope(a, team || opp);
    let g = sc.pool.filter(visible);
    if (team) g = g.filter(m => involves(m, team));
    if (opp) g = g.filter(m => involves(m, opp));
    if (team && a.side) g = g.filter(m => sideOf(m, team) === a.side);
    if (team && a.result) g = g.filter(m => (m.winner === sideOf(m, team)) === (a.result === 'win'));
    if (a.game_number) g = g.filter(m => Number(m.gameNum || 1) === Number(a.game_number));
    if (a.format) g = g.filter(m => norm(m.seriesFormat) === norm(a.format));
    if (a.hero) {
      const h = findHero(a.hero), by = a.hero_by || (team ? 'team' : 'either');
      g = g.filter(m => ['blue', 'red'].some(s => {
        if (team && by !== 'either' && (by === 'team') !== (sideOf(m, team) === s)) return false;
        return (m[s + 'Picks'] || []).some(p => nm(p) === h);
      }));
    }
    if (a.first_pick) {
      const h = findHero(a.first_pick);
      g = g.filter(m => ['blue', 'red'].some(s => (!team || sideOf(m, team) === s) && (s === 'blue' ? [(m.bluePicks || [])[0]] : (m.redPicks || []).slice(0, 2)).some(p => nm(p) === h)));
    }
    if (a.banned_hero) { const h = findHero(a.banned_hero); g = g.filter(m => [...(m.blueBans || []), ...(m.redBans || [])].some(b => nm(b) === h)); }
    if (a.player) { const p = norm(a.player); g = g.filter(m => [...(m.bluePicks || []), ...(m.redPicks || [])].some(x => x && norm(x.player) === p)); }
    g.sort(byDateDesc);
    const out = [`Scope: ${sc.label}. Matching games: ${g.length}.`];
    if (!g.length) return out.join('\n') + '\nNo games match — try a wider scope (season "all", no stage) or check names with list_data.';
    if (team) {
      const w = g.filter(m => m.winner === sideOf(m, team)).length;
      const sd = s => { const x = g.filter(m => sideOf(m, team) === s); return `${s} ${wl(x.filter(m => m.winner === s).length, x.length)}`; };
      out.push(`${team}: ${wl(w, g.length)} (${pct(w / g.length)}%) · ${sd('blue')} · ${sd('red')}`);
      const W = root.WIntel, dW = [], dL = [];
      g.forEach(m => { const d = W.mins(m.duration); if (d && d > 3 && d < 60) (m.winner === sideOf(m, team) ? dW : dL).push(d); });
      const avg = x => x.reduce((p, q) => p + q, 0) / x.length;
      if (dW.length || dL.length) out.push(`Avg duration: wins ${dW.length ? avg(dW).toFixed(1) + 'm' : '—'}, losses ${dL.length ? avg(dL).toFixed(1) + 'm' : '—'}`);
      const picks = [], bans = [], vsBans = [], opps = [];
      g.forEach(m => { const s = sideOf(m, team), win = m.winner === s;
        (m[s + 'Picks'] || []).forEach(p => picks.push([nm(p), win])); (m[s + 'Bans'] || []).forEach(b => bans.push([nm(b), win]));
        (m[other(s) + 'Bans'] || []).forEach(b => vsBans.push([nm(b), win])); opps.push([s === 'blue' ? m.redTeam : m.blueTeam, win]); });
      out.push(`Their picks: ${topTxt(count(picks), 10)}`);
      out.push(`Their bans: ${topTxt(count(bans), 8)}`);
      out.push(`Banned against them: ${topTxt(count(vsBans), 8)}`);
      if (!opp) out.push(`Opponents: ${topTxt(count(opps), 10)}`);
    } else {
      const bw = g.filter(m => m.winner === 'blue').length;
      out.push(`Blue side won ${wl(bw, g.length)} (${pct(bw / g.length)}%).`);
      const picks = [], bans = [];
      g.forEach(m => ['blue', 'red'].forEach(s => { (m[s + 'Picks'] || []).forEach(p => picks.push([nm(p), m.winner === s])); (m[s + 'Bans'] || []).forEach(b => bans.push([nm(b), false])); }));
      out.push(`Most picked: ${topTxt(count(picks), 10)}`);
      out.push(`Most banned: ${Object.entries(count(bans)).sort((x, y) => y[1].g - x[1].g).slice(0, 10).map(([h, v]) => `${h} ${v.g}`).join(', ')}`);
    }
    const lim = a.limit === 0 ? 0 : Math.min(25, Math.max(1, Number(a.limit) || 10));
    if (lim) { out.push(`Games (newest first${g.length > lim ? `, ${lim} of ${g.length}` : ''}):`); g.slice(0, lim).forEach(m => out.push(gameLine(m))); }
    return out.join('\n');
  };

  function notesFor(x, team, lg, seasons) {
    const t = x.meta[team]; if (!t) return '';
    const lm = (t.leagueMeta || {});
    const k = (seasons || []).map(s => `${lg}::${s}`).find(k2 => lm[k2]);
    const v = (k && lm[k]) || t;
    const parts = [];
    if (v.placement) parts.push(`placement ${v.placement}`);
    if (v.rsRank) parts.push(`regular-season rank ${v.rsRank}`);
    if (v.winCondition) parts.push(`win condition: ${v.winCondition}`);
    if (v.coachNotes) parts.push(`coach notes: ${String(v.coachNotes).slice(0, 600)}`);
    return parts.length ? `Warr.GG scouting notes${k ? ' (' + k.replace('::', ' ') + ')' : ''}: ${parts.join(' · ')}` : '';
  }
  function rosterFor(x, team, seasons) {
    const rows = x.roster.filter(r => r.team_name === team);
    if (!rows.length) return '';
    const ss = [...new Set(rows.map(r => r.season || ''))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const se = (seasons || []).find(s => ss.includes(s)) || ss[0];
    const cur = rows.filter(r => (r.season || '') === se);
    return `Roster${se ? ' ' + se : ''}: ${cur.map(r => `${r.ign}${r.role ? ' (' + r.role + ')' : ''}${r.real_name ? ' — ' + r.real_name : ''}${r.is_active === false ? ' [inactive]' : ''}`).join(', ')}`;
  }

  IMPL.team_report = async (a) => {
    const W = root.WIntel, team = findTeam(a.team, true), sc = scope(a, team);
    const season = scope({ ...a, stage: '' }, team).pool.filter(m => !isScrim(m));   // strength + stage split use every stage
    const R = W.ratings(season);
    let pool = sc.pool.filter(m => !isScrim(m));
    if (a.side) pool = pool.filter(m => sideOf(m, team) !== other(a.side));
    const I = W.team(pool, team, R), lv = W.levers(I), x = await extras();
    const out = [`=== ${team} — ${sc.label}${a.side ? ' · ' + a.side + ' side only' : ''} · ${I.n} official games ===`];
    if (!I.n) return out.join('\n') + `\nNo games in this scope. Try season "all".`;
    const split = W.stageSplit(season, team);
    out.push(`By stage: ${Object.entries(split).map(([k, v]) => `${k}: games ${v.gw}-${v.gl}, series ${v.sw}-${v.sl}`).join(' | ')}`);
    const ser = W.series(pool, team).slice(0, 12);
    if (ser.length) out.push(`Series (newest first): ${ser.map(s => `${(s.date || '').slice(0, 10)} ${s.stageRaw || s.stage}${s.format ? ' ' + s.format : ''} ${s.result === 'W' ? 'W' : s.result === 'L' ? 'L' : 'D'} ${s.w}-${s.l} vs ${s.opp}`).join('; ')}`);
    out.push(W.promptBlock(I, lv));
    const pls = W.LANES.filter(l => I.lanes[l]).map(l => { const L = I.lanes[l]; return `${l}: ${L.main || '?'}${L.mainG ? ` (${L.mainG}g)` : ''} — pool ${L.pool} heroes, top two = ${pct(L.share2)}% of games`; });
    if (pls.length) out.push(`Players & pool depth — ${pls.join(' | ')}`);
    if (I.signature.length) out.push(`Signature heroes (games, record): ${I.signature.slice(0, 8).map(s => `${s.hero}${s.lane ? '/' + s.lane : ''} ${wl(s.w, s.g)}`).join(', ')}`);
    const ed = W.edges(I); if (ed.length) out.push(`Strengths: ${ed.join('; ')}`);
    const n1 = notesFor(x, team, sc.lg, sc.seasons); if (n1) out.push(n1);
    const r1 = rosterFor(x, team, sc.seasons); if (r1) out.push(r1);
    const scr = C.usable.filter(m => isScrim(m) && involves(m, team));
    if (scr.length) out.push(`User's own scrims with ${team}: ${scr.length} games (query_games include_scrims for detail).`);
    return out.join('\n');
  };

  IMPL.draft_tendencies = async (a) => {
    const W = root.WIntel, team = findTeam(a.team, true), sc = scope(a, team);
    let pool = sc.pool.filter(m => !isScrim(m) && involves(m, team));
    if (a.side) pool = pool.filter(m => sideOf(m, team) === a.side);
    const D = W.draftOrder(pool, team);
    const out = [`=== ${team} draft tendencies — ${sc.label}${a.side ? ' · ' + a.side + ' side' : ''} · ${D.n} games ===`];
    if (!D.n) return out.join('\n') + '\nNo games in this scope.';
    out.push(W.draftOrderBlock(D));
    // "If we ban their favourite first pick, what do they take?"
    if (!D.laneOrdered) ['blue', 'red'].forEach(s => {
      const fav = Object.entries(D.first[s]).sort((x, y) => y[1].g - x[1].g).slice(0, 2);
      fav.forEach(([h]) => {
        const gs = pool.filter(m => sideOf(m, team) === s && (m[s + 'Picks'] || []).length === 5 && [...(m.blueBans || []), ...(m.redBans || [])].slice(0).some(b => nm(b) === h));
        if (gs.length < 2) return;
        const alt = count(gs.map(m => { const p = m[s + 'Picks']; return [nm(s === 'blue' ? p[0] : p[0]), m.winner === s]; }));
        if (s === 'red') gs.forEach(m => { const p = m.redPicks; const k = nm(p[1]); const x2 = alt[k] || (alt[k] = { g: 0, w: 0 }); x2.g++; if (m.winner === 'red') x2.w++; });
        out.push(`- When ${h} is banned (${gs.length} ${s} games), their ${s === 'blue' ? 'B1' : 'R1-R2'}: ${topTxt(alt, 5)}`);
      });
    });
    // Comfort by player (who gets the early picks)
    if (!D.laneOrdered) {
      const early = []; pool.forEach(m => { const s = sideOf(m, team), p = m[s + 'Picks'] || []; if (p.length !== 5) return; (s === 'blue' ? p.slice(0, 1) : p.slice(0, 2)).forEach(x => early.push([x && (x.player || x.lane), m.winner === s])); });
      const e = count(early); if (Object.keys(e).length) out.push(`- Who their first pick goes to (player or lane): ${topTxt(e, 5)}`);
    }
    return out.join('\n');
  };

  IMPL.matchup = async (a) => {
    const W = root.WIntel, A = findTeam(a.team_a, true), B = findTeam(a.team_b, true);
    const sa = scope(a, A), sb = a.league ? sa : scope({ ...a, league: '' }, B);
    const off = p => p.filter(m => !isScrim(m));
    const sAll = a.stage ? scope({ ...a, stage: '' }, A) : sa;
    const RA = W.ratings(off(sAll.pool));
    const out = [`=== ${A} vs ${B} — ${sa.label}${sb.lg !== sa.lg ? ` / ${sb.label}` : ''} ===`];
    if (RA.games[A] && RA.games[B]) {
      out.push(`Model (opponent-adjusted, ${sAll.label}${a.stage ? ', all stages' : ''}): ${A} wins a game ${pct(RA.pGame(A, B))}% (blue ${pct(RA.pGame(A, B, 'blue'))}%, red ${pct(RA.pGame(A, B, 'red'))}%), BO3 ${pct(RA.pSeries(A, B, 3))}%, BO5 ${pct(RA.pSeries(A, B, 5))}%, BO7 ${pct(RA.pSeries(A, B, 7))}%. Strength rank ${A} #${RA.rank(A)}, ${B} #${RA.rank(B)} of ${RA.teams}.`);
    } else out.push('No shared league/season sample — no win-probability model; compare profiles instead.');
    const h2h = C.usable.filter(m => !isScrim(m) && involves(m, A) && involves(m, B)).sort(byDateDesc);
    const aw = h2h.filter(m => m.winner === sideOf(m, A)).length;
    const ss = W.series(h2h, A);
    out.push(`Head-to-head (official, all seasons): games ${A} ${wl(aw, h2h.length)}; series ${ss.filter(x => x.result === 'W').length}-${ss.filter(x => x.result === 'L').length}${ss.length ? ' — ' + ss.slice(0, 6).map(x => `${(x.date || '').slice(0, 10)} ${x.stageRaw || x.stage} ${x.w}-${x.l}`).join('; ') : ''}`);
    const IA = W.team(off(sa.pool), A, RA), IB = W.team(off(sb.pool), B, sb === sa ? RA : W.ratings(off(sb.pool)));
    const DA = W.draftOrder(off(sa.pool), A), DB = W.draftOrder(off(sb.pool), B);
    const sideTxt = I => `blue ${wl(I.side.blue.w, I.side.blue.g)}, red ${wl(I.side.red.w, I.side.red.g)}`;
    out.push(`Records in scope: ${A} ${wl(IA.wins, IA.n)} (${sideTxt(IA)}) · ${B} ${wl(IB.wins, IB.n)} (${sideTxt(IB)})`);
    const banIdeas = (I, by, D2) => I.banImpact.filter(b => b.impact > 0 && b.z > 0.3).slice(0, 4).map(b => {
      const usual = (D2.p1bans.blue[b.hero]?.g || 0) + (D2.p1bans.red[b.hero]?.g || 0) + (D2.p2bans.blue[b.hero]?.g || 0) + (D2.p2bans.red[b.hero]?.g || 0);
      return `${b.hero} (${I.team} ${pct(b.availWR)}% when open → ${pct(b.bannedWR)}% when banned, ${b.bannedG}g banned; ${by} banned it ${usual}x in ${D2.n}g)`;
    });
    const bA = banIdeas(IB, A, DA), bB = banIdeas(IA, B, DB);
    if (bA.length) out.push(`${B}'s ban-impact heroes (team-specific only — for actual ban advice use ban_plan, which also weighs the meta): ${bA.join('; ')}`);
    if (bB.length) out.push(`${A}'s ban-impact heroes (what ${B} may target): ${bB.join('; ')}`);
    const sig = I => new Set(I.signature.slice(0, 8).map(s => s.hero));
    const sA = sig(IA), sB = sig(IB), both = [...sA].filter(h => sB.has(h));
    if (both.length) out.push(`Contested (signature for both): ${both.join(', ')}`);
    const fp = D => Object.entries({ ...D.first.blue }).map(([h, v]) => [h, v.g + (D.first.red[h]?.g || 0)]).concat(Object.entries(D.first.red).filter(([h]) => !D.first.blue[h]).map(([h, v]) => [h, v.g])).sort((x, y) => y[1] - x[1]).slice(0, 4);
    if (!DA.laneOrdered && !DB.laneOrdered) out.push(`First-pick priorities: ${A} ${fp(DA).map(([h, c]) => `${h} ${c}`).join(', ') || '—'} | ${B} ${fp(DB).map(([h, c]) => `${h} ${c}`).join(', ') || '—'}`);
    const beat = (I) => I.beatenBy.filter(b => b.z > 0.3).slice(0, 4).map(b => `${b.hero} ${b.oppW}-${b.g - b.oppW}`).join(', ');
    if (beat(IB)) out.push(`Heroes that have beaten ${B} (above what opponent strength predicts): ${beat(IB)}`);
    if (beat(IA)) out.push(`Heroes that have beaten ${A} (above what opponent strength predicts): ${beat(IA)}`);
    if (h2h.length) { out.push('Last H2H games:'); h2h.slice(0, 4).forEach(m => out.push(gameLine(m))); }
    return out.join('\n');
  };

  IMPL.hero_report = async (a) => {
    const W = root.WIntel, h = findHero(a.hero, true), sc = scope(a);
    const pool = sc.pool.filter(m => !isScrim(m));
    const x = W.hero(pool, h), out = [`=== ${h} — ${sc.label} (${x.games} games) ===`];
    x.teams = x.teams.filter(t => !C.locked(t.replace(/ \d+-\d+$/, '')));
    out.push(`${x.picks} picks, ${x.bans} bans → ${pct(x.pres)}% presence${x.wr != null ? `, ${pct(x.wr)}% WR (${wl(x.wins, x.picks)})` : ''}. Lanes: ${x.lanes.join(', ') || '—'}. Teams: ${x.teams.join(', ') || '—'}.`);
    const pl = [], slot = [], duo = [], lane = [], patch = [], banP = { p1: 0, p2: 0 };
    pool.forEach(m => ['blue', 'red'].forEach(s => {
      const bans = (m[s + 'Bans'] || []).map(nm), bi = bans.indexOf(h); if (bi >= 0) banP[bi < 3 ? 'p1' : 'p2']++;
      const picks = m[s + 'Picks'] || [], i = picks.findIndex(p => nm(p) === h); if (i < 0) return;
      const win = m.winner === s, me = picks[i], t = s === 'blue' ? m.blueTeam : m.redTeam;
      if (me && me.player && !C.locked(t)) pl.push([`${me.player} (${t})`, win]);
      if (picks.length === 5 && picks.map(p => p && p.lane).join(',') !== LANE_SEQ) slot.push([W.slotLabel(s, i), win]);
      picks.forEach((p, j) => { if (j !== i) duo.push([nm(p), win]); });
      if (me && me.lane) (m[other(s) + 'Picks'] || []).forEach(p => { if (p && p.lane === me.lane) lane.push([nm(p), win]); });
      patch.push([m.patch || '(no patch)', win]);
    }));
    out.push(`Banned in phase 1: ${banP.p1}, phase 2: ${banP.p2}.`);
    if (pl.length) out.push(`Players: ${topTxt(count(pl), 8)}`);
    if (slot.length) out.push(`Draft slot taken: ${topTxt(count(slot), 6)}`);
    const rank = (o, min, best) => {
      const r = Object.entries(o).filter(([, v]) => v.g >= min).map(([k, v]) => [k, v, shrink(v.w, v.g, x.wr ?? 0.5, 3)]).sort((p, q) => q[2] - p[2]);
      const half = Math.ceil(r.length / 2);   // best and worst never overlap
      return (best ? r.slice(0, Math.min(4, half)) : r.slice(half).reverse().slice(0, 4)).map(([k, v]) => `${k} ${wl(v.w, v.g)}`).join(', ');
    };
    const D = count(duo), Ln = count(lane);
    if (Object.keys(D).length) out.push(`Best duo partners (same team, 3+ games): ${rank(D, 3, true) || '—'} · weakest: ${rank(D, 3, false) || '—'}`);
    if (Object.keys(Ln).length) out.push(`Lane matchups (${h}'s record vs the same-lane hero, 2+ games): best ${rank(Ln, 2, true) || '—'} · worst ${rank(Ln, 2, false) || '—'}`);
    out.push(`Vs any enemy hero (3+ games): best into ${x.bestInto.join(', ') || '—'} · struggles into ${x.worstInto.join(', ') || '—'}`);
    const P = count(patch); if (Object.keys(P).length > 1) out.push(`By patch: ${Object.entries(P).sort((p, q) => q[0].localeCompare(p[0], undefined, { numeric: true })).map(([k, v]) => `${k} ${wl(v.w, v.g)}`).join(', ')}`);
    const opp = (hh, same) => {
      let g = 0, w = 0;
      pool.forEach(m => ['blue', 'red'].forEach(s => {
        if (!(m[s + 'Picks'] || []).some(p => nm(p) === h)) return;
        const side2 = same ? s : other(s);
        if ((m[side2 + 'Picks'] || []).some(p => nm(p) === hh)) { g++; if (m.winner === s) w++; }
      }));
      return { g, w };
    };
    if (a.vs_hero) { const v = findHero(a.vs_hero), r = opp(v, false); out.push(`${h} vs ${v} (opposite teams): ${h} ${wl(r.w, r.g)} in ${r.g} games.`); }
    if (a.with_hero) { const v = findHero(a.with_hero), r = opp(v, true); out.push(`${h} with ${v} (same team): ${wl(r.w, r.g)} in ${r.g} games.`); }
    const ex = await extras();
    const rel = ex.rel[h];
    if (rel && (rel.counter.length || rel.synergy.length)) out.push(`Warr.GG curated: counters ${rel.counter.join(', ') || '—'} · synergies ${rel.synergy.join(', ') || '—'}`);
    const t100 = ex.top100 && Array.isArray(ex.top100.heroes) ? ex.top100.heroes.find(r => norm(r.hero || r.name) === norm(h)) : null;
    if (t100) out.push(`Solo queue (global Top 100 snapshot ${ex.top100.scraped_at}): used by ${t100.top100_users ?? '?'} of the top ${ex.top100.total_players || 100} players${t100.avg_win_rate != null ? `, avg ${Math.round(t100.avg_win_rate * (t100.avg_win_rate <= 1 ? 100 : 1))}% WR` : ''}${t100.avg_games != null ? `, ~${Math.round(t100.avg_games)} games each` : ''}.`);
    const pt = ex.patches.slice().sort((p, q) => (q.dateFrom || '').localeCompare(p.dateFrom || ''))[0];
    const tier = pt && pt.heroes && pt.heroes[h] && pt.heroes[h].tier;
    if (tier) out.push(`Patch tier list (${pt.name}): ${tier}`);
    const HDx = await heroData();
    if (HDx) {
      const kl = HDx.kitLine(h); if (kl) out.push(`Kit (Liquipedia): ${kl}`);
      const ch = HDx.changes(h).slice(0, 2); if (ch.length) out.push(`Recent patch changes: ${ch.map(c => HDx.changeLine(c, 220)).join(' | ')}`);
    }
    return out.join('\n');
  };

  // ── Hero kits + patch notes (Liquipedia via /api/hero-data) ─────────────
  async function heroData() {
    const H = root.WHeroData; if (!H) return null;
    if (!H.ready()) { try { await Promise.race([H.load({ full: true }), new Promise(r => setTimeout(r, 22000))]); } catch (_) {} }
    return H.ready() ? H : null;
  }
  const heroDataMissing = () => {
    const st = root.WHeroData && root.WHeroData.state;
    return st === 'empty' || st === 'loading'
      ? 'Patch notes and hero kits are still loading on Warr.GG for the first time — they fill in from Liquipedia within a minute or two (Liquipedia itself is fine). Showing pro play only for now.'
      : 'Couldn\'t reach Warr.GG\'s hero-data service just now (a Warr.GG connection issue, not Liquipedia). Showing pro play only for now.';
  };
  IMPL.patch_report = async (a) => {
    const H = await heroData();
    if (!H) throw fail(heroDataMissing() + ' (For pro stats: league_report / hero_report.)');
    const games = C.usable.filter(m => !isScrim(m) && visible(m));
    let mm = null; try { mm = root.WDraft ? draftModel() : null; } catch (_) { mm = null; }
    const x = await extras();
    const pp = H.patchPower({ games, top100: x.top100, model: mm && mm.model });
    const cur = pp.patch;
    const rank = r => `${r.hero}${r.lane ? ' (' + r.lane + ')' : ''} ${r.tier}${r.trend ? ' ↑↓'.charAt(r.trend === 'rising' ? 1 : 2) : ''}`;
    const out = [];
    const head = cur ? `patch ${cur.name} (since ${cur.release}${cur.name !== cur.major ? `; ${cur.major} since ${cur.since}` : ''}) · ${pp.games} pro games on ${cur.major}${cur.prevMajor ? `, ${pp.prevGames} on ${cur.prevMajor}` : ''}` : 'patch unknown';
    if (a.hero) {
      const h = findHero(a.hero, true);
      const kit = H.hero(h);
      out.push(`=== ${h} — kit & patch history · ${head} ===`);
      if (kit) {
        out.push(`Kit: ${H.kitLine(h)}`);
        const st = kit.stats || {};
        if (Object.keys(st).length) out.push(`Base stats: HP ${st.hp ?? '?'} · HP regen ${st.hpreg ?? '?'} · Phys ATK ${st.phyatk ?? '?'} · Phys DEF ${st.phydef ?? '?'} · Mag DEF ${st.magdef ?? '?'} · ATK speed ${st.atkspeed ?? '?'} · Move speed ${st.movespeed ?? '?'}${st.mana ? ' · Mana ' + st.mana : ''}`);
        out.push('Skills:', ...H.skillsText(h, 380).split('\n').map(l => '  ' + l));
      } else out.push('Kit: not on Liquipedia yet.');
      const ch = H.changes(h);
      if (ch.length) {
        out.push('Patch history (newest first):', ...ch.slice(0, 6).map(c => '  ' + H.changeLine(c, 320) + (c.note ? ` — designers: "${c.note.slice(0, 160)}"` : '')));
        if (kit && kit.edited && ch[0].release && kit.edited.slice(0, 10) < ch[0].release) out.push(`Note: the kit numbers above are from the hero page (last edited ${kit.edited.slice(0, 10)}), before the ${ch[0].patch} change — trust the patch-history numbers where they differ.`);
      } else out.push('Patch history: no changes in the recent patches.');
      const r = pp.rows.find(z => norm(z.hero) === norm(h));
      if (r && r.tier !== '—') out.push(`This patch: ${r.tier}-tier, #${r.rank} of ${pp.rows.filter(z => z.tier !== '—').length} (score ${r.score}: pro ${r.parts.pro}, patch changes ${r.parts.kit}, model ${r.parts.model}, solo queue ${r.parts.solo})${r.trend ? ' · ' + r.trend : ''} — ${r.reasons.join(' · ')}`);
      out.push(`Source: kit and patch notes — ${H.CREDIT}; pro games — Warr.GG.`);
      return out.join('\n');
    }
    const lane = a.lane ? String(a.lane) : '';
    const laneOk = r => !lane || norm(r.lane) === norm(lane) || (norm(lane) === 'exp' && /exp/i.test(r.lane));
    const rows = pp.rows.filter(r => r.tier !== '—' && laneOk(r));
    const top = Math.max(5, Math.min(30, Number(a.top) || 15));
    out.push(`=== Patch power${lane ? ' — ' + lane : ''} · ${head} ===`, pp.note);
    out.push(`TOP NOW${lane ? ' (' + lane + ')' : ''}:`);
    rows.slice(0, top).forEach((r, i) => out.push(`${i + 1}. ${rank(r)} — ${r.reasons.slice(0, 3).join(' · ')}`));
    const thisP = pp.rows.filter(r => laneOk(r) && r.kit && r.kit.changes.some(c => cur && c.release >= cur.since));
    const fmt = r => { const c = r.kit.changes.find(z => cur && z.release >= cur.since); return `${r.hero} (${H.changeLine(c, 150).replace(/^\S+ \S+ (\([^)]*\) )?— /, c.patch + ': ')})`; };
    const buffs = thisP.filter(r => r.kit.changes.some(c => c.release >= cur.since && c.type === 'buff' || (c.type === 'adjust' && c.score > 0.05)) && r.kit.delta > 0).sort((p, q) => q.kit.delta - p.kit.delta);
    const nerfs = thisP.filter(r => r.kit.delta < 0).sort((p, q) => p.kit.delta - q.kit.delta);
    const rev = thisP.filter(r => r.revamp);
    if (buffs.length) out.push(`BUFFED THIS PATCH: ${buffs.slice(0, 10).map(fmt).join(' | ')}`);
    if (nerfs.length) out.push(`NERFED THIS PATCH: ${nerfs.slice(0, 10).map(fmt).join(' | ')}`);
    if (rev.length) out.push(`REVAMPED (untested — watch them): ${rev.map(r => r.hero).join(', ')}`);
    const cmp = pp.games >= 10 && pp.prevGames >= 10;
    if (cmp) {
      const d = r => r.pro.pres - r.pro.presPrev;
      const up = pp.rows.filter(r => laneOk(r) && d(r) > 0.12).sort((p, q) => d(q) - d(p)).slice(0, 6);
      const dn = pp.rows.filter(r => laneOk(r) && d(r) < -0.12).sort((p, q) => d(p) - d(q)).slice(0, 6);
      if (up.length) out.push(`RISING in pro play: ${up.map(r => `${r.hero} ${Math.round(r.pro.presPrev * 100)}% → ${Math.round(r.pro.pres * 100)}%`).join(', ')}`);
      if (dn.length) out.push(`FALLING in pro play: ${dn.map(r => `${r.hero} ${Math.round(r.pro.presPrev * 100)}% → ${Math.round(r.pro.pres * 100)}%`).join(', ')}`);
    }
    out.push(`How it's scored: pro presence + win rate on this patch (trusted more as games come in), patch-note changes (strongest before games exist, fading as games are played on them), the draft model's hero effect, solo-queue Top 100. Raw kit numbers alone never decide it.`);
    out.push(`Source: patch notes — ${H.CREDIT}; pro games — Warr.GG.`);
    return out.join('\n');
  };

  IMPL.player_report = async (a) => {
    if (!a.player) throw fail('A player IGN is required.');
    const P = allPlayers(), k = norm(a.player);
    const hit = P[k] || Object.values(P).find(p => norm(p.name).includes(k) && k.length >= 3);
    const ex = await extras();
    const ros = ex.roster.filter(r => norm(r.ign) === (hit ? norm(hit.name) : k));
    if (!hit) {
      if (ros.length) return `${a.player}: on roster ${ros.map(r => `${r.team_name} ${r.season || ''} (${r.role || '?'})`).join(', ')}, but no logged games tag this player.`;
      throw fail(`No player "${a.player}" in the logged games (players are tagged per pick).`);
    }
    const teams = Object.keys(hit.teams).filter(t => !C.locked(t));
    if (!teams.length) throw fail(`${hit.name} plays for a private team — data locked.`);
    const sc = scope(a, teams.sort((x, y) => hit.teams[y] - hit.teams[x])[0]);
    const games = [];
    sc.pool.filter(m => !isScrim(m) && visible(m)).forEach(m => ['blue', 'red'].forEach(s => (m[s + 'Picks'] || []).forEach(p => { if (p && norm(p.player) === norm(hit.name)) games.push({ m, s, p, win: m.winner === s }); })));
    games.sort((x, y) => byDateDesc(x.m, y.m));
    const out = [`=== ${hit.name} — ${sc.label} · ${games.length} games ===`];
    if (ros.length) out.push(`Roster: ${ros.map(r => `${r.team_name}${r.season ? ' ' + r.season : ''}${r.role ? ' ' + r.role : ''}${r.real_name ? ' (' + r.real_name + ')' : ''}`).join(', ')}`);
    if (!games.length) return out.join('\n') + '\nNo games in this scope — try season "all".';
    const w = games.filter(x => x.win).length;
    out.push(`Record ${wl(w, games.length)} · teams: ${topTxt(count(games.map(x => [x.s === 'blue' ? x.m.blueTeam : x.m.redTeam, x.win])), 3)} · lanes: ${topTxt(count(games.map(x => [x.p.lane, x.win])), 3)}`);
    const H = {};
    games.forEach(x => { const h = nm(x.p); const r = H[h] || (H[h] = { g: 0, w: 0, k: 0, d: 0, as: 0, kg: 0 }); r.g++; if (x.win) r.w++; if (x.p.kda) { r.k += +x.p.kda.k || 0; r.d += +x.p.kda.d || 0; r.as += +x.p.kda.a || 0; r.kg++; } });
    out.push(`Hero pool: ${Object.entries(H).sort((p, q) => q[1].g - p[1].g).slice(0, 12).map(([h, r]) => `${h} ${wl(r.w, r.g)}${r.kg ? ` (KDA ${(r.k / r.kg).toFixed(1)}/${(r.d / r.kg).toFixed(1)}/${(r.as / r.kg).toFixed(1)})` : ''}`).join(', ')}`);
    out.push(`Last games: ${games.slice(0, 8).map(x => `${(x.m.date || '').slice(0, 10)} ${nm(x.p)} ${x.win ? 'W' : 'L'} vs ${x.s === 'blue' ? x.m.redTeam : x.m.blueTeam}`).join('; ')}`);
    return out.join('\n');
  };

  IMPL.league_report = async (a) => {
    const W = root.WIntel;
    let lgName = a.league;
    if (!lgName) { lgName = (C.myTeam && teamLeague(C.myTeam)) || leagues()[0]; if (!lgName) throw fail('No league data.'); }
    const sc = scope({ ...a, league: lgName });
    const pool = sc.pool.filter(m => !isScrim(m));
    const out = [`=== ${sc.label} — ${pool.length} games ===`];
    if (!pool.length) return out.join('\n') + '\nNo games in this scope.';
    const st = W.standings(pool);
    if (st.length) out.push(`REGULAR SEASON STANDINGS (series W-L, then game difference): ${st.map((r, i) => `${i + 1}. ${r.team} ${r.sw}-${r.sl} (${r.gw}-${r.gl}, ${r.gw - r.gl >= 0 ? '+' : ''}${r.gw - r.gl})`).join(' | ')}`);
    const po = W.playoffSeries(pool);
    if (po.length) out.push(`PLAYOFF SERIES (oldest first): ${po.map(x => `${(x.date || '').slice(0, 10)} ${x.stage}${x.format ? ' ' + x.format : ''}: ${x.a} ${x.aw}-${x.bw} ${x.b}`).join('; ')}`);
    const R = W.ratings(pool);
    out.push(`Opponent-adjusted strength (NOT standings): ${Object.keys(R.r).sort((x, y) => R.r[y] - R.r[x]).slice(0, 16).map((t, i) => `${i + 1}. ${t}`).join(' | ')} · blue-side edge ${R.blueAdv >= 0 ? '+' : ''}${R.blueAdv.toFixed(2)} logit`);
    const bw = pool.filter(m => m.winner === 'blue').length;
    const ds = pool.map(m => W.mins(m.duration)).filter(d => d && d > 3 && d < 60);
    out.push(`Blue side won ${wl(bw, pool.length)} (${pct(bw / pool.length)}%)${ds.length ? ` · avg game ${(ds.reduce((p, q) => p + q, 0) / ds.length).toFixed(1)}m` : ''}`);
    out.push(`Meta (presence = picked or banned per game): ${W.meta(pool).slice(0, 20).map(m => `${m.hero} ${pct(m.pres)}% (${m.picks}p/${m.bans}b${m.picks >= 4 ? ', ' + pct(m.wr) + '% WR' : ''})`).join(', ')}`);
    const fp = [], p1 = [];
    pool.forEach(m => {
      const bp = m.bluePicks || [], rp = m.redPicks || [];
      if (bp.length === 5 && bp.map(p => p && p.lane).join(',') !== LANE_SEQ) fp.push([nm(bp[0]), m.winner === 'blue']);
      ['blue', 'red'].forEach(s => (m[s + 'Bans'] || []).slice(0, 3).forEach(b => p1.push([nm(b), false])));
      void rp;
    });
    if (fp.length) out.push(`Most common blue first picks (B1): ${topTxt(count(fp), 8)}`);
    if (p1.length) out.push(`Most common phase-1 bans: ${Object.entries(count(p1)).sort((x, y) => y[1].g - x[1].g).slice(0, 10).map(([h, v]) => `${h} ${v.g}`).join(', ')}`);
    return out.join('\n');
  };

  // ── Draft model (trained once per data set, cached) ───────────────────
  const M = { key: '', model: null, lanes: null };
  function draftModel() {
    const WD = root.WDraft; if (!WD) throw fail('Draft model not loaded.');
    // On AI Battle the page trains its own model (same data + curated counters):
    // use it so Heimer, the win meter and the AI all give the same numbers.
    const pg = root.heimerDraftModel;
    if (pg && pg.model && pg.model.w) return { key: 'page', model: pg.model, lanes: pg.lanes || {}, source: pg.source || 'page' };
    const off = C.usable.filter(m => !isScrim(m));
    const key = off.length + '|' + off.reduce((x, m) => ((m.date || '') > x ? m.date || '' : x), '');
    if (M.key !== key) {
      M.model = WD.train(off, { roster: root.WDB && root.WDB.HERO_ROSTER, archetypes: root.WDB && root.WDB.COMP_ARCHETYPES, relations: X.rel || null });
      M.lanes = WD.lanePool(off, 2); M.key = key;
    }
    return M;
  }
  T.draftModel = () => draftModel();
  const ORDER = [['ban', 'blue'], ['ban', 'red'], ['ban', 'blue'], ['ban', 'red'], ['ban', 'blue'], ['ban', 'red'],
    ['pick', 'blue'], ['pick', 'red'], ['pick', 'red'], ['pick', 'blue'], ['pick', 'blue'], ['pick', 'red'],
    ['ban', 'red'], ['ban', 'blue'], ['ban', 'red'], ['ban', 'blue'], ['pick', 'red'], ['pick', 'blue'], ['pick', 'blue'], ['pick', 'red']];
  function nextStep(dr) {
    if ((dr.bluePicks || []).length >= 5 && (dr.redPicks || []).length >= 5) return null;
    const noBans = !(dr.blueBans || []).length && !(dr.redBans || []).length && ((dr.bluePicks || []).length || (dr.redPicks || []).length);
    const c = { 'ban|blue': 0, 'ban|red': 0, 'pick|blue': 0, 'pick|red': 0 };
    for (const [k, sd] of ORDER) {
      if (noBans && k === 'ban') continue;          // bans not given → follow the pick order only
      const have = (dr[sd + (k === 'ban' ? 'Bans' : 'Picks')] || []).length;
      if (c[k + '|' + sd] >= have) return { kind: k, side: sd };
      c[k + '|' + sd]++;
    }
    return null;
  }
  function readDraft(a, mm) {
    const lanes = mm.lanes || {};
    const pk = (arr, side) => (Array.isArray(arr) ? arr : []).map(x => {
      const raw = typeof x === 'string' ? { hero: x.replace(/\s*\(.*\)\s*$/, ''), lane: (x.match(/\((\w+)\)/) || [])[1] } : (x || {});
      const h = findHero(raw.hero || raw.name, true);
      let lane = raw.lane && ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'].find(l => l.toLowerCase() === String(raw.lane).toLowerCase());
      return { name: h, lane: lane || '', side };
    });
    const bp = pk(a.blue_picks, 'blue'), rp = pk(a.red_picks, 'red');
    // infer missing lanes: the hero's most common lane among those still open
    [bp, rp].forEach(ps => ps.forEach(p => { if (p.lane) return; const used = ps.map(q => q.lane).filter(Boolean); p.lane = (lanes[p.name] || []).find(l => !used.includes(l)) || ''; p.inferred = !!p.lane; }));
    const bans = arr => (Array.isArray(arr) ? arr : []).map(x => findHero(x, true));
    // a team the data doesn't know (e.g. "You" on AI Battle) or a private one
    // just means: no team-specific terms — the draft is still rated
    const tryTeam = x => { try { return x ? findTeam(x) : ''; } catch (_) { return ''; } };
    const bt = tryTeam(a.blue_team), rt = tryTeam(a.red_team);
    return { blueTeam: bt, redTeam: rt, bluePicks: bp, redPicks: rp, blueBans: bans(a.blue_bans), redBans: bans(a.red_bans) };
  }
  const pts = x => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
  const pickTxt = ps => ps.map(p => `${p.name}${p.lane ? ' (' + p.lane + (p.inferred ? '?' : '') + ')' : ''}`).join(', ') || '—';

  IMPL.evaluate_draft = async (a) => {
    await extras();
    const WD = root.WDraft, mm = draftModel(), model = mm.model;
    if (!model || !Object.keys(model.w).length) return `Draft model unavailable: ${(model && model.meta.note) || 'not enough games with full picks.'}`;
    const dr = readDraft(a, mm);
    const s = WD.score(model, dr);
    const base = s.parts.filter(p => p.group === 'side' || p.group === 'str').reduce((x, p) => x + p.logit, 0);
    const pBase = 1 / (1 + Math.exp(-base));
    const out = [`=== Draft model ===`, `BLUE ${dr.blueTeam || '(team not set)'}: ${pickTxt(dr.bluePicks)}${dr.blueBans.length ? ' · bans ' + dr.blueBans.join(', ') : ''}`,
      `RED ${dr.redTeam || '(team not set)'}: ${pickTxt(dr.redPicks)}${dr.redBans.length ? ' · bans ' + dr.redBans.join(', ') : ''}`];
    if (dr.bluePicks.some(p => p.inferred) || dr.redPicks.some(p => p.inferred)) out.push('(lane? = inferred from where that hero is usually played)');
    const pDraft = WD.prob(model, dr, { noStrength: true });
    out.push(`Draft only (team strength excluded — what the AI Battle win meter shows): BLUE ${Math.round(pDraft * 100)}% / RED ${Math.round((1 - pDraft) * 100)}%.`);
    out.push(`Win chance: BLUE ${Math.round(s.p * 100)}% / RED ${Math.round((1 - s.p) * 100)}%. ${dr.blueTeam && dr.redTeam ? 'Side + team strength' : 'Side'} alone: BLUE ${Math.round(pBase * 100)}% → the draft itself moves it ${pts((s.p - pBase) * 100)} pts for blue.`);
    const fac = side => s.parts.filter(p => p.group !== 'side' && p.group !== 'str' && (side === 'blue' ? p.pts > 0 : p.pts < 0)).slice(0, 6)
      .map(p => `${p.label} ${pts(Math.abs(p.pts))} (${p.n} games)`).join(', ');
    out.push(`Draft factors for BLUE (win-% pts): ${fac('blue') || 'none significant'}`);
    out.push(`Draft factors for RED (win-% pts): ${fac('red') || 'none significant'}`);
    if (s.thin.length) out.push(`Thin data (<3 games, low weight): ${s.thin.slice(0, 6).join(', ')}`);
    const nx = nextStep(dr);
    const sf = a.suggest_for || (nx && nx.kind === 'pick' ? nx.side : 'none');
    if (nx) out.push(`Next in the draft: ${nx.side} ${nx.kind}.`);
    const sideList = sf === 'both' ? ['blue', 'red'] : sf === 'blue' || sf === 'red' ? [sf] : [];
    sideList.forEach(sd => {
      if ((dr[sd + 'Picks'] || []).length >= 5) return;
      const sg = WD.suggest(model, dr, sd, { pool: mm.lanes, limit: 8 });
      if (sg.length) out.push(`Best next picks for ${sd.toUpperCase()} by the model: ${sg.map(x => `${x.hero} (${x.lane}) ${pts(x.gain * 100)}${x.why.length ? ' [' + x.why.join('; ') + ']' : ''}${x.n < 5 ? ' (thin)' : ''}`).join(' | ')}`);
    });
    // what a named team will likely do next
    if (nx) {
      const t = nx.side === 'blue' ? dr.blueTeam : dr.redTeam;
      if (t && !C.locked(t)) {
        const P = root.WDraft.policy(scope({}, t).pool.filter(m => !isScrim(m)), t);
        const pr = root.WDraft.predict(P, dr, t, nx.side, nx.kind, { limit: 5 });
        if (pr.list.length) out.push(`${t}'s habits say their ${pr.slot} will likely be: ${pr.list.map(x => `${x.hero}${x.lane ? ' (' + x.lane + ')' : ''} ${Math.round(x.prob * 100)}% [${x.why.join('; ')}]`).join(' | ')}`);
      }
    }
    out.push(root.WDraft.summary(model));
    return out.join('\n');
  };

  IMPL.predict_draft = async (a) => {
    await extras();
    const WD = root.WDraft, mm = draftModel();
    const team = findTeam(a.team, true);
    const dr = readDraft({ ...a, blue_team: a.side === 'blue' ? team : a.opponent, red_team: a.side === 'blue' ? a.opponent : team }, mm);
    const side = a.side || (dr.blueTeam === team ? 'blue' : 'red');
    const sc = scope(a, team);
    const pool = sc.pool.filter(m => !isScrim(m));
    const P = WD.policy(pool, team);
    const nx = nextStep(dr);
    const kind = a.kind || (nx && nx.side === side ? nx.kind : (nx ? nx.kind : 'pick'));
    const meta = {}; root.WIntel.meta(pool).forEach(x => { meta[x.hero] = x.pres; });
    const pr = WD.predict(P, dr, team, side, kind, { meta, limit: 6 });
    const out = [`=== ${team} — predicted ${pr.slot} (${side} side, ${sc.label}, ${P.n} games of habits; ${pr.sample} games at this exact slot) ===`];
    out.push(`Draft so far — BLUE: ${pickTxt(dr.bluePicks)}${dr.blueBans.length ? ' · bans ' + dr.blueBans.join(', ') : ''} | RED: ${pickTxt(dr.redPicks)}${dr.redBans.length ? ' · bans ' + dr.redBans.join(', ') : ''}`);
    out.push(`Most likely (habit): ${pr.list.map(x => `${x.hero}${x.lane ? ' (' + x.lane + ')' : ''} ${Math.round(x.prob * 100)}% [${x.why.join('; ') || 'general'}]`).join(' | ') || 'no history'}`);
    if (kind === 'pick' && mm.model && Object.keys(mm.model.w).length) {
      const sg = WD.suggest(mm.model, dr, side, { pool: mm.lanes, limit: 5 });
      if (sg.length) out.push(`Best for them by the draft model: ${sg.map(x => `${x.hero} (${x.lane}) ${pts(x.gain * 100)} pts`).join(' | ')}`);
    }
    if (pr.sample < 4) out.push(`Only ${pr.sample} games at this slot — leaning on their overall picks.`);
    return out.join('\n');
  };

  // ── Draft brain: league-wide expert brain + how each team thinks ───────
  const BR = { key: '', p: null };
  function brainNow() {
    if (!root.WBrain) throw fail('Draft brain not loaded.');
    const off = C.usable.filter(m => !isScrim(m));
    const key = off.length + '|' + off.reduce((z, m) => ((m.date || '') > z ? m.date || '' : z), '');
    if (BR.key !== key || !BR.p) {
      BR.key = key;
      BR.p = Promise.all([extras(), heroData().catch(() => null)]).then(([x, H]) => {
        const kitProfiles = {};
        if (H && root.WHeroProfile) Object.keys(H.data().heroes).forEach(t => { const n = H.siteName(t); if (!root.WHeroProfile.get(n) || root.WHeroProfile.get(n).fromKit) kitProfiles[n] = { info: H.data().heroes[t].info, traits: H.data().heroes[t].traits }; });
        return root.WBrain.buildAsync(off, { relations: x.rel || {}, calendar: H ? H.calendar() : undefined, kitProfiles });
      });
    }
    return BR.p;
  }
  T.brain = () => brainNow();
  const accLine = brain => {
    const a = brain.acc || {}, gs = Object.keys(a); if (!gs.length) return 'Engine check: not enough recent drafts to test yet.';
    const sum = (k, f) => gs.filter(f).reduce((s2, g) => s2 + a[g][k] * a[g].n, 0) / Math.max(1, gs.filter(f).reduce((s2, g) => s2 + a[g].n, 0));
    const isBan = g => g.startsWith('ban'), isPick = g => g.startsWith('pick');
    return `Engine check (predicting the newest 20% of real drafts it never saw): bans — right hero in its top 3 ${pct(sum('top3', isBan))}% of the time (presence alone ${pct(sum('pop3', isBan))}%); picks — ${pct(sum('top3', isPick))}% (presence alone ${pct(sum('pop3', isPick))}%).`;
  };
  IMPL.team_brain = async (a) => {
    const team = findTeam(a.team, true);
    const brain = await brainNow();
    if (!brain.models || !Object.keys(brain.models).length) return `The draft brain needs 12+ logged games with full pick order — it has ${brain.n}.`;
    const M = root.WBrain.teamMind(brain, team);
    if (!M) return `${team} has no logged drafts with full pick order in the brain's window (${brain.n} most recent games).`;
    const arrow = x => (x.d >= 0.05 ? ' ▲' : x.d <= -0.05 ? ' ▼' : '');
    const out = [`=== How ${team} drafts — learned from ${M.nPicks} of their picks and ${M.nBans} bans (league brain: ${brain.n} games, ${brain.decisions} decisions) ===`, accLine(brain)];
    out.push(`WHY THEY PICK (share of their picks · league): ${M.picks.slice(0, 7).map(x => `${x.label} ${pct(x.team)}% (${pct(x.league)}%)${arrow(x)}`).join(', ')}`);
    out.push(`WHY THEY BAN: ${M.bans.slice(0, 6).map(x => `${x.label} ${pct(x.team)}% (${pct(x.league)}%)${arrow(x)}`).join(', ')}`);
    const ph = M.philosophy.filter(p => p.n >= 3 && p.league > 0).sort((x, y) => Math.abs(Math.log((y.ratio || 0.01))) - Math.abs(Math.log((x.ratio || 0.01))));
    if (ph.length) out.push(`PHILOSOPHY vs league (×1.0 = average): ${ph.slice(0, 7).map(p => `${p.label} ×${p.ratio.toFixed(2)}${p.ratio >= 1.25 ? ' (more)' : p.ratio <= 0.8 ? ' (less)' : ''}`).join('; ')}`);
    out.push(`Predictability: the brain had their actual pick in its top 3 ${pct(M.predictable)}% of the time — ${M.predictable >= 0.55 ? 'by-the-book drafter' : M.predictable <= 0.35 ? 'creative / hard to read' : 'about league-typical'}.`);
    if (M.types.length) out.push(`DRAFT TYPES they run (found in the data): ${M.types.map(x => `${x.type} ${pct(x.share)}% (that type wins ${pct(x.wr)}% league-wide)`).join('; ')}`);
    if (M.pockets.length) out.push(`Pocket picks (first-time / rare heroes): ${M.pockets.slice(0, 8).join(', ')}`);
    if (brain.shifts && brain.shifts.list && brain.shifts.list.length) out.push(`Patch ${brain.shifts.patch} shifts (from the data): ${brain.shifts.list.slice(0, 6).map(x => `${x.hero} ${x.dir === 'up' ? '▲' : '▼'} ${pct(x.before)}%→${pct(x.after)}%`).join(', ')}`);
    // their latest draft, explained
    const ids = brain.gameIds || (brain.games || []).map(g => g.id);
    const lastId = [...ids].reverse().find(id => (brain.decs || []).some(d => d.game === id && d.team === team));
    if (lastId) {
      const g = (brain.games || []).find(x => x.id === lastId) || {};
      const ex = root.WBrain.explainGame(brain, lastId).filter(d => d.team === team);
      out.push(`Their latest draft${g.date ? ` (${g.date}${g.blueTeam ? `, ${g.blueTeam} vs ${g.redTeam}` : ''})` : ''}: ${ex.map(d => `${d.kind === 'ban' ? 'ban' : 'pick'} ${d.hero} — ${d.label}${d.rank != null ? ` (option #${d.rank + 1})` : ''}`).join('; ')}`);
    }
    return out.join('\n');
  };
  IMPL.explain_game = async (a) => {
    const team = findTeam(a.team, true), opp = a.opponent ? findTeam(a.opponent) : '';
    const brain = await brainNow();
    const games = (brain.games || []).filter(g => involves(g, team) && (!opp || involves(g, opp)) && (!a.date || (g.date || '').startsWith(a.date)) && (!a.game_number || Number(g.gameNum) === Number(a.game_number)));
    const g = games[games.length - 1];
    if (!g) return `No logged game with full pick order found for ${team}${opp ? ' vs ' + opp : ''}${a.date ? ' on ' + a.date : ''}.`;
    const ex = root.WBrain.explainGame(brain, g.id);
    const slot = d => { const o = root.WBrain.ORDER[d.step - 1]; return o ? (o[0] === 'ban' ? `${o[1]} ban ${o[2] + 1}` : `${o[1] === 'blue' ? 'B' : 'R'}${o[2] + 1}`) : ''; };
    return [`=== ${g.blueTeam} (blue) vs ${g.redTeam} (red) — ${g.date}${g.stage ? ' · ' + g.stage : ''}${g.gameNum ? ' · game ' + g.gameNum : ''} · ${g.winner === 'blue' ? g.blueTeam : g.redTeam} won ===`,
      ...ex.map(d => `${d.step}. ${slot(d)} ${d.team}: ${d.hero} — ${d.label}${d.why.length > 1 ? ' (+' + d.why.slice(1).join(', ') + ')' : ''} · option #${d.rank + 1} (${pct(d.p || 0)}%)`),
      'Option # = where the brain ranked the choice among what was open (1 = the expected move; high numbers = a surprise).'].join('\n');
  };

  // ── Ban plan: the WBan engine (warr-ban.js) over everything we log ─────
  IMPL.ban_plan = async (a) => {
    const x = await extras();
    const W = root.WIntel, WB = root.WBan;
    if (!WB) throw fail('Ban engine not loaded.');
    const opp = findTeam(a.opponent || a.team_b, true);
    let us = '';
    try { us = a.team ? findTeam(a.team) : (C.myTeam && !C.locked(C.myTeam) && C.myTeam !== opp ? C.myTeam : ''); } catch (_) { us = ''; }
    if (us === opp) us = '';
    const off = p => p.filter(m => !isScrim(m));
    const sc = scope(a, opp), seasonSc = a.stage ? scope({ ...a, stage: '' }, opp) : sc;
    const meta = off(seasonSc.pool);
    if (!meta.length) return `No games in ${sc.label}.`;
    let oppGames = off(sc.pool).filter(m => involves(m, opp));
    if (a.stage && oppGames.length < 6) oppGames = meta.filter(m => involves(m, opp));            // thin playoff sample → whole season
    if (!oppGames.length) return `${opp} has no games in ${sc.label} — try season "all".`;
    let usGames = [];
    if (us) { try { usGames = off(scope({ ...a, stage: '' }, us).pool).filter(m => involves(m, us)); } catch (_) { usGames = []; } }
    const scrims = us ? C.usable.filter(m => isScrim(m) && involves(m, us)) : [];
    const last = meta.reduce((z, m) => ((m.date || '') > z ? m.date || '' : z), '');
    const lo = new Date((Date.parse(last) || Date.now()) - 120 * 864e5).toISOString().slice(0, 10);
    const cross = C.usable.filter(m => !isScrim(m) && m.league !== sc.lg && (m.date || '') >= lo && (m.date || '') <= last);
    let mm = null; try { mm = root.WDraft ? draftModel() : null; } catch (_) { mm = null; }
    const ourSide = a.side === 'blue' || a.side === 'red' ? a.side : '';
    const theirSide = ourSide ? (ourSide === 'blue' ? 'red' : 'blue') : 'red';
    const dr = readDraft({ blue_team: theirSide === 'blue' ? opp : us, red_team: theirSide === 'red' ? opp : us,
      blue_picks: a.blue_picks, red_picks: a.red_picks, blue_bans: a.blue_bans, red_bans: a.red_bans }, mm || { lanes: {} });
    let tierOf = () => '';
    try {
      const dd = JSON.parse(localStorage.getItem('mlbb_draft_data') || 'null');
      const pt = x.patches.slice().sort((p, q) => (q.dateFrom || '').localeCompare(p.dateFrom || ''))[0];
      tierOf = h => (pt && pt.heroes && pt.heroes[h] && pt.heroes[h].tier) || (dd && dd.tierList && dd.tierList[h] && dd.tierList[h].tier) || '';
    } catch (_) {}
    const mustBan = h => { try { return typeof HEROES !== 'undefined' && (HEROES.find(z => z.name === h) || {}).mp === 'mustban'; } catch (_) { return false; } };   // eslint-disable-line no-undef
    const series = (a.series || []).map(g => ({ theirPicks: (g.their_picks || []).map(h => { try { return findHero(h); } catch (_) { return h; } }), weWon: !!g.we_won }));
    const R = W.ratings(meta);
    const res = WB.plan({ opp, us, meta, oppGames, usGames, scrims, cross, R, side: ourSide, phase: a.phase ? Number(a.phase) : 0,
      draft: dr, series, stage: /play-?off|final|semi|bracket|knock/i.test(a.stage || '') ? 'Playoffs' : '', map: a.map || '',
      model: mm && mm.model, lanes: mm && mm.lanes, relations: x.rel || {}, archetypes: root.WDB && root.WDB.COMP_ARCHETYPES, tierOf, mustBan, top100: x.top100,
      ...(await heroData().then(H => H ? { kit: H.kitBySite({ games: C.usable.filter(m => !isScrim(m)) }), patchOf: m => H.patchOfGame(m) } : {}).catch(() => ({}))) });
    const pts = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
    const line = (r, i) => `${i + 1}. ${r.hero}${r.lane ? ' (' + r.lane + ')' : ''} [${r.kind} · ${r.conf}] — ${r.factors.slice(0, 4).map(f => `${f.label} (${pts(f.v)})`).join('; ')}`
      + (r.flags.pickInstead ? ' · CONTESTED: you can first-pick it instead' : '') + (r.flags.theyBan ? ` · they ban it ${r.flags.theyBan}% of games — may not need your ban` : '');
    const out = [`=== Ban plan vs ${opp} — ${sc.label}${us ? ` · for ${us}` : ''}${ourSide ? ` · you are ${ourSide.toUpperCase()}` : ''} · phase ${res.phase} ===`,
      `Based on ${res.n.league} ${seasonSc.label} games (meta${res.curPatch ? ', patch ' + res.curPatch : ''}), ${res.n.opp} ${opp} games${us ? `, ${res.n.us} ${us} games` : ''}${res.n.scrims ? `, ${res.n.scrims} of your scrims` : ''}${cross.length ? `, ${cross.length} games from other leagues` : ''}. Each ban = how likely they pick it × what they lose vs their next-best option, plus meta denial, their identity and threats to you; points ≈ win-%.`];
    const strat = [];
    res.strategy.forEach(st => strat.push(`Lane-lock their ${st.lane}${st.main ? ' (' + st.main + ')' : ''}: ${st.heroes.join(' + ')} cover ${pct(st.share)}% of their ${st.lane} games — banning both forces them off-comfort.`));
    res.notes.forEach(n2 => strat.push(n2));
    if (strat.length) out.push('STRATEGY: ' + strat.join(' '));
    if (res.phase === 1) {
      const order = ourSide === 'blue' ? 'your bans go 1st, 3rd and 5th' : ourSide === 'red' ? 'your bans go 2nd, 4th and 6th' : 'B-R-B-R-B-R';
      out.push(`PHASE 1 — ban in this order (${order}):`);
      res.picked.forEach((r, i) => out.push(line(r, i)));
      out.push('Also strong:');
      res.rows.filter(r => !res.picked.includes(r)).slice(0, 4).forEach((r, i) => out.push(line(r, i + 3)));
      out.push(`PHASE 2 preview (ban into the roles ${opp} still needs): ${Object.entries(res.phase2).map(([l, hs]) => `${l}: ${hs.join(', ')}`).join(' | ')}`);
    } else {
      out.push(`PHASE 2 — ${opp} still needs ${res.theirOpen.join(', ') || 'nothing'}:`);
      res.picked.forEach((r, i) => out.push(line(r, i)));
      res.rows.filter(r => !res.picked.includes(r)).slice(0, 3).forEach((r, i) => out.push(line(r, i + 2)));
    }
    const contested = res.rows.slice(0, 12).filter(r => r.flags.contested);
    if (contested.length) out.push(`Contested (your heroes too): ${contested.slice(0, 4).map(r => `${r.hero} (you ${r.flags.contested})`).join(', ')}${ourSide === 'blue' && res.phase === 1 ? ' — with first pick, take the best one instead of banning it' : ''}.`);
    if (res.theirBans.length) out.push(`Expect ${opp} to ban: ${res.theirBans.map(b => `${b.hero} ${b.n}/${b.of}`).join(', ')}.`);
    return out.join('\n');
  };

  // ── Heimer Lite: answers from the tools alone — no language model ──────
  // Used when there's no AI access or the AI budget is used up. It cannot
  // invent anything (every line is a tool result over the site's data), but it
  // reads questions by keywords, so every answer says what it looked up.
  const RX = {
    playoffs: /\b(play-?offs?|knock-?outs?|brackets?|grand ?finals?|finals?|semis?|semi-?finals?)\b/i,
    regular: /\b(regular season|reg season|group stage|weeks?)\b/i,
    draftNow: /\b(what (should|do|can) (i|we) (pick|ban)|(pick|ban) (now|next)|next (pick|ban)|what to (pick|ban)|best pick|counter[- ]?pick|ano (pick|ban))\b/i,
    rate: /\b(draft|lineup|comp)\b.*\b(good|bad|rate|strong|win|chance|better|ok)\b|\bwho wins\b|\bwin (rate|chance|%)\b/i,
    predict: /\b(what will|what would|predict|likely|expect|gonna)\b|\bwhen\b.*\bbanned\b|\bif we ban\b/i,
    draftHabit: /\b(first[- ]?pick|last pick|draft(s|ing)?|bans?|banning|phase|priority|habits?|adjust)\b/i,
    vs: /\b(vs\.?|versus|against|beat|matchup|h2h|head[- ]to[- ]head|kalaban)\b/i,
    league: /\b(standings?|table|rank(ing)?s?|meta|contested|tier|strongest|best teams?|top teams?|who.?s (the )?best|league)\b/i,
    player: /\b(player|ign|hero pool|plays)\b/i,
  };
  const KEYLINE = {
    evaluate_draft: [/^Win chance:.*/m, /^Draft only.*/m, /^Best next picks for .*/m, /^.*'s habits say .*/m],
    predict_draft: [/^Most likely \(habit\):.*/m, /^Best for them by the draft model:.*/m],
    draft_tendencies: [/^- Blue first pick.*/m, /^- Red first two.*/m, /^- When .* is banned.*/m],
    matchup: [/^Model \(.*/m, /^Bans for .*/m, /^Head-to-head.*/m],
    team_report: [/^.* · strength rank .*/m, /^Data levers — .*/m],
    team_brain: [/^WHY THEY PICK.*/m, /^WHY THEY BAN.*/m, /^PHILOSOPHY.*/m, /^Predictability.*/m],
    explain_game: [/^=== .*/m],
    ban_plan: [/^STRATEGY: .*/m, /^1\. .*/m, /^2\. .*/m, /^3\. .*/m],
    hero_report: [/^\d+ picks, .*/m, /^Lane matchups.*/m],
    player_report: [/^Record .*/m, /^Hero pool: .*/m],
    league_report: [/^REGULAR SEASON STANDINGS.*/m, /^Meta .*/m],
    patch_report: [/^This patch: .*/m, /^1\. .*/m, /^2\. .*/m, /^BUFFED THIS PATCH: .*/m, /^NERFED THIS PATCH: .*/m, /^Kit: .*/m],
  };
  function toMd(text) {
    return String(text || '').split('\n').map(l => {
      const t = l.replace(/\s+$/, '');
      let m;
      if ((m = t.match(/^=== (.*) ===$/))) return `#### ${m[1]}`;
      if (/^\s*- /.test(t)) return t.trim();
      if (/^\s{2,}\S/.test(t)) return `- ${t.trim()}`;
      if ((m = t.match(/^([A-Z][A-Za-z0-9 '’()·,./+-]{2,48}?)(:| —) (.+)$/))) return `- **${m[1]}${m[2] === ':' ? ':' : ' —'}** ${m[3]}`;
      return t;
    }).join('\n');
  }
  function liteHelp() {
    const lg = (C.myTeam && teamLeague(C.myTeam)) || leagues()[0] || 'MPL PH';
    const tm = visibleTeams().find(t => teamLeague(t) === lg && t !== C.myTeam) || 'ONIC PH';
    return [`I'm in **free mode** — I answer straight from Warr.GG's data (no AI writing), so name a team, hero, player or league and I'll pull it up. Try:`,
      `- "What's ${tm}'s weakness?"`, `- "${C.myTeam || 'Aurora PH'} vs ${tm} in playoffs"`, `- "What does ${tm} first pick?" · "What will ${tm} pick if we ban Ling?"`,
      `- "Fanny vs Ling" · "Who plays Chou best?"`, `- "${lg} standings" · "${lg} meta"`, `- On AI Battle: "What should I pick now?"`].join('\n');
  }
  T.lite = async function (q, ctx, page) {
    C = ctx;
    const text = String(q || '');
    const all = [...new Set(C.usable.flatMap(m => [m.blueTeam, m.redTeam]))];
    const vis = all.filter(t => !C.locked(t));
    const myLg = C.myTeam ? teamLeague(C.myTeam) : '';
    const named = root.WIntel.findTeams(text, vis, t => (t === C.myTeam ? 3 : 0) + (myLg && teamLeague(t) === myLg ? 1 : 0));
    const lockedHit = root.WIntel.findTeams(text, all.filter(t => C.locked(t)));
    const we = /\b(we|us|our|my team|kami|namin|natin|tayo)\b/i.test(text) && C.myTeam;
    // subject first: the team the question is ABOUT (not "us"), then us for matchups
    let teams = named.filter(t => !(we && t === C.myTeam));
    if (we) teams.push(C.myTeam);
    if (!teams.length && named.length) teams = named.slice();
    teams = [...new Set(teams)].slice(0, 2);
    const heroes = root.WIntel.findHeroes(text, allHeroes());
    const stage = RX.playoffs.test(text) ? 'Playoffs' : RX.regular.test(text) ? 'Regular Season' : '';
    const side = /\bblue\b/i.test(text) ? 'blue' : /\bred\b/i.test(text) ? 'red' : '';
    let player = '';
    { const P = allPlayers(); const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3); const hit = Object.values(P).find(p => words.includes(norm(p.name)) && Object.keys(p.teams).some(t => !C.locked(t))); if (hit) player = hit.name; }
    const st = stage ? { stage } : {};
    const pd = page && page.draft;
    const calls = [];
    if (teams.length && /\b(how|what).*\b(draft|think|style|approach|philosophy|thought process|mindset)\b|\b(style|thought process|philosophy|mindset|tendencies)\b/i.test(text) && !/\bban/i.test(text)) {
      calls.push(['team_brain', { team: teams[0] }]);
    } else if (teams.length && /\b(explain|why did|break ?down)\b.*\b(draft|pick|ban|game)\b/i.test(text)) {
      calls.push(['explain_game', { team: teams[0], opponent: teams[1] || undefined }]);
    }
    if (calls.length) { /* routed above */ }
    else if (lockedHit.length && !teams.length) return { text: `I can't see **${lockedHit.join(', ')}** — that team's data is private.`, looked: '' };
    const pdOpp = pd ? (pd.userSide === 'blue' ? pd.redTeam : pd.blueTeam) : '';
    if (calls.length) { /* already routed */ } else if (pd && pdOpp && /\bbans?\b|banning/i.test(text) && !/\bpick\b/i.test(text)) {
      const P = a => (a || []).map(p => ({ hero: p.name, lane: p.lane || undefined }));
      calls.push(['ban_plan', { opponent: pdOpp, side: pd.userSide, blue_picks: P(pd.bluePicks), red_picks: P(pd.redPicks), blue_bans: pd.blueBans, red_bans: pd.redBans }]);
    } else if (pd && (RX.draftNow.test(text) || RX.rate.test(text) || (!teams.length && !heroes.length && /\b(pick|ban|draft)\b/i.test(text)))) {
      const P = a => (a || []).map(p => ({ hero: p.name, lane: p.lane || undefined }));
      calls.push(['evaluate_draft', { blue_team: pd.blueTeam || undefined, red_team: pd.redTeam || undefined, blue_picks: P(pd.bluePicks), red_picks: P(pd.redPicks), blue_bans: pd.blueBans, red_bans: pd.redBans,
        suggest_for: pd.next && pd.next.kind === 'pick' ? pd.next.side : (pd.userSide || 'none') }]);
    } else if (teams.length && /\bbans?\b|\bbanning\b/i.test(text) && !/\bbanned\b/i.test(text) && !(/\b(will|would|does|do|usually|always)\b[^?]*\bbans?\b/i.test(text) && !/\b(we|us|our|should|i)\b/i.test(text))) {
      const oppT = teams.find(t => t !== C.myTeam) || teams[0];
      const ph = /phase ?2|second phase|last bans?|2nd phase/i.test(text) ? 2 : /phase ?1|first phase|first bans?|1st phase/i.test(text) ? 1 : undefined;
      calls.push(['ban_plan', { opponent: oppT, side: side || undefined, phase: ph, ...st }]);
    } else if (teams.length && RX.predict.test(text)) {
      const banned = /\bbann?ed\b|\bif we ban\b/i.test(text) ? heroes : [];
      const tSide = side || 'red';
      calls.push(['predict_draft', { team: teams[0], side: tSide, kind: /\bpick(s|ed|ing)?\b|first[- ]?pick/i.test(text) ? 'pick' : /\bbans?\b/i.test(text) && !banned.length ? 'ban' : 'pick', [tSide === 'red' ? 'blue_bans' : 'red_bans']: banned, ...st }]);
      calls.push(['draft_tendencies', { team: teams[0], ...st, ...(side ? { side } : {}) }]);
    } else if (teams.length >= 2 || (teams.length === 1 && RX.vs.test(text) && C.myTeam && teams[0] !== C.myTeam)) {
      const a2 = teams.length >= 2 ? (teams.includes(C.myTeam) ? C.myTeam : teams[0]) : C.myTeam;
      const b2 = teams.length >= 2 ? teams.find(t => t !== a2) : teams[0];
      calls.push(['matchup', { team_a: a2, team_b: b2, ...st }]);
    } else if (teams.length && RX.draftHabit.test(text)) {
      calls.push(['draft_tendencies', { team: teams[0], ...st, ...(side ? { side } : {}) }]);
    } else if (teams.length) {
      calls.push(['team_report', { team: teams[0], ...st, ...(side ? { side } : {}) }]);
    } else if (heroes.length && /\b(skills?|kit|abilit\w*|passive|ultimate|ult|cool ?downs?|cd|what does .* do|buff(ed|s)?|nerf(ed|s)?|changed?|patch)\b/i.test(text)) {
      calls.push(['patch_report', { hero: heroes[0] }]);
    } else if (!heroes.length && /\b(this patch|current patch|new patch|patch|buff(ed|s)?|nerf(ed|s)?|op|overpowered|strongest|broken|tier ?list|meta heroes|malakas|lakas)\b/i.test(text) && !/\bstandings?\b|\btable\b/i.test(text)) {
      const ln = (text.match(/\b(exp|jungle|jungler|mid|gold|roam|roamer)\b/i) || [])[1];
      const lane = ln ? ({ exp: 'EXP', jungle: 'Jungle', jungler: 'Jungle', mid: 'Mid', gold: 'Gold', roam: 'Roam', roamer: 'Roam' })[ln.toLowerCase()] : undefined;
      calls.push(['patch_report', { lane }]);
    } else if (player && (RX.player.test(text) || !heroes.length)) {
      calls.push(['player_report', { player, ...st }]);
    } else if (heroes.length) {
      const vsH = heroes.length >= 2 && RX.vs.test(text) ? heroes[1] : undefined;
      const withH = heroes.length >= 2 && !vsH ? heroes[1] : undefined;
      calls.push(['hero_report', { hero: heroes[0], vs_hero: vsH, with_hero: withH, ...st }]);
    } else if (RX.league.test(text) || stage) {
      calls.push(['league_report', { ...st }]);
    }
    if (!calls.length) return { text: liteHelp(), looked: '' };
    const outs = [];
    for (const [n, a] of calls) outs.push({ n, label: T.describe(n, a, C).replace(/…$/, ''), text: await T.run(n, a, C) });
    if (outs.length === 1 && outs[0].n === 'patch_report' && /^ERROR/.test(outs[0].text)) {   // no patch data yet → still answer from pro play
      const a2 = calls[0][1].hero ? { hero: calls[0][1].hero } : {};
      const n2 = a2.hero ? 'hero_report' : 'league_report';
      outs.push({ n: n2, label: T.describe(n2, a2, C).replace(/…$/, ''), text: await T.run(n2, a2, C) });
    }
    const take = [];
    outs.forEach(o => (KEYLINE[o.n] || []).forEach(rx => { const m = o.text.match(rx); if (m && take.length < 4) take.push(m[0].replace(/^- /, '').trim()); }));
    const looked = outs.map(o => o.label).join(' · ');
    const body = [`*Looked up: ${looked}*`];
    if (take.length && !outs.every(o => /^ERROR/.test(o.text))) body.push('**Quick take**', ...take.map(t => `- ${t}`));
    outs.forEach(o => body.push('', toMd(o.text)));
    return { text: body.join('\n'), looked };
  };

  T.run = async function (name, input, ctx) {
    C = ctx;
    const f = IMPL[name];
    if (!f) return `Unknown tool "${name}".`;
    try { return cap(await f(input || {})); }
    catch (e) { return `ERROR: ${e && e.tool ? e.message : 'tool failed — ' + ((e && e.message) || e)}`; }
  };

  root.HeimerTools = T;
})(typeof window !== 'undefined' ? window : globalThis);
