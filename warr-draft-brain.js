// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — WBrain: the league-wide "expert brain" (step A of the Team Draft Brain)
//
// Every logged game holds 20 expert decisions (10 bans, 10 picks), each made
// with alternatives on the table. WBrain replays every draft in order and learns
// what pros choose given the situation — a discrete-choice model per draft phase:
//
//   P(hero | draft state) ∝ exp( w_phase · features(hero, state) )
//
// Features are the reasons a coach has: meta priority (how badly pros want it
// when it's open — not its win rate), trend & patch shifts, team comfort,
// player comfort, denying the enemy's comfort, countering what the enemy
// showed, blind-pick risk (how counterable it still is), synergy with own
// picks, comp needs (frontline / engage / damage mix), flex value, the team's
// lane order at that slot, pocket picks; for bans: meta, their comfort and
// first picks, threats to our comfort and picks, the roles they still need,
// one-trick lane pools. All stats are rolling (only games BEFORE each draft),
// so the accuracy check is honest.
//
//   WBrain.build(matches, opts)          → brain (weights, rolling stats, accuracy)
//   WBrain.predict(brain, draft, team, opp, side, kind)  → ranked candidates + why
//   WBrain.explainGame(brain, game)      → each decision of a real game with its reason
//   WBrain.teamMind(brain, team)         → how a team thinks: reason mix vs the league,
//                                          philosophy scores, draft types
//   WBrain.types(brain)                  → draft types found in the data (clusters)
// Needs: WHeroProfile (warr-hero-profiles.js), WIntel (warr-intel.js).
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const B = {};
  const nm = p => String((p && (p.name || p)) || '').trim();
  const LANES = ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'];
  const DAY = 864e5;
  // Draft order (MPL): bans B R B R B R · picks B1 R1 R2 B2 B3 R3 · bans R B R B · picks R4 B4 B5 R5
  const ORDER = [['ban', 'blue', 0], ['ban', 'red', 0], ['ban', 'blue', 1], ['ban', 'red', 1], ['ban', 'blue', 2], ['ban', 'red', 2],
    ['pick', 'blue', 0], ['pick', 'red', 0], ['pick', 'red', 1], ['pick', 'blue', 1], ['pick', 'blue', 2], ['pick', 'red', 2],
    ['ban', 'red', 3], ['ban', 'blue', 3], ['ban', 'red', 4], ['ban', 'blue', 4],
    ['pick', 'red', 3], ['pick', 'blue', 3], ['pick', 'blue', 4], ['pick', 'red', 4]];
  const GROUP = i => (i <= 5 ? 'ban1' : i <= 8 ? 'pick1' : i <= 11 ? 'pick2' : i <= 15 ? 'ban2' : i <= 18 ? 'pick3' : 'pick4');
  const GROUP_LABEL = { ban1: 'Phase 1 bans', pick1: 'First picks (B1, R1-R2)', pick2: 'Phase 1 closing picks (B2-B3, R3)', ban2: 'Phase 2 bans', pick3: 'Phase 2 picks (R4, B4-B5)', pick4: 'Last pick (R5)' };
  const PICK_F = ['prio', 'pres', 'trend', 'wr', 'comfortT', 'comfortP', 'deny', 'counter', 'blindRisk', 'synergy', 'fixes', 'flex', 'laneHabit', 'pocket', 'slotHabit'];
  const BAN_F = ['prio', 'banRate', 'trend', 'wr', 'enemyComfort', 'enemyFirst', 'threat', 'ownComfort', 'roleNeed', 'lanePool', 'slotHabit'];
  const TOPK = 22;                                   // candidates kept per decision (+ the actual choice)
  const FAMILY = {
    prio: 'power', pres: 'power', trend: 'meta trend', wr: 'power', patch: 'meta trend', comfortT: 'comfort', comfortP: 'player comfort', deny: 'deny',
    counter: 'counter', blindRisk: 'safe blind', synergy: 'synergy', fixes: 'comp fix', flex: 'flex / hide', laneHabit: 'lane plan', pocket: 'pocket pick',
    slotHabit: 'team habit', banRate: 'meta ban', enemyComfort: 'target ban', enemyFirst: 'target ban', threat: 'protect ban', ownComfort: 'own hero', roleNeed: 'role ban', lanePool: 'lane-lock ban',
  };
  const NOT_REASON = new Set(['ownComfort', 'pocket', 'roleNeed_neg']);
  B.setLambda = v => { LAMBDA = v; };
  // Liquipedia patch calendar (release dates); games without a patch get one from their date.
  const CALENDAR = [['1.8.92C', '2024-07-22'], ['1.9.06', '2024-07-31'], ['1.9.06B', '2024-08-05'], ['1.9.06C', '2024-08-08'], ['1.9.20', '2024-09-18'], ['1.9.20B', '2024-09-25'], ['1.9.20C', '2024-10-10'],
    ['1.9.20D', '2024-11-05'], ['1.9.20E', '2024-11-12'], ['1.9.42', '2024-12-18'], ['1.9.42B', '2025-01-01'], ['1.9.42C', '2025-02-01'], ['1.9.42D', '2025-02-07'], ['1.9.42E', '2025-02-13'],
    ['1.9.64', '2025-03-18'], ['1.9.64B', '2025-04-22'], ['1.9.64C', '2025-05-14'], ['1.9.90', '2025-06-18'], ['1.9.99', '2025-08-05'], ['1.9.99a', '2025-08-26'], ['2.1.18', '2025-09-17'],
    ['2.1.18a', '2025-09-29'], ['2.1.18b', '2025-10-24'], ['2.1.30', '2025-11-04'], ['2.1.30a', '2025-11-27'], ['2.1.40', '2025-12-18'], ['2.1.40a', '2025-12-31'], ['2.1.47', '2026-01-28'],
    ['2.1.61', '2026-03-11'], ['2.1.67', '2026-04-22'], ['2.1.67a', '2026-05-13']];
  B.CALENDAR = CALENDAR;
  const majorOf = p => String(p || '').replace(/[a-zA-Z]+$/, '');          // 2.1.40a → 2.1.40 (hotfixes fold in)
  // Newer patches arrive automatically from Liquipedia (WHeroData.calendar()).
  let EXTRA_CAL = [], CAL_SORTED = CALENDAR.slice();
  B.setCalendar = function (list) {
    EXTRA_CAL = (Array.isArray(list) ? list : []).filter(c => Array.isArray(c) && c[0] && /^\d{4}-\d{2}-\d{2}$/.test(c[1] || ''));
    const seen = new Set(); CAL_SORTED = [...EXTRA_CAL, ...CALENDAR].filter(c => !seen.has(c[0]) && seen.add(c[0])).sort((a, b) => a[1].localeCompare(b[1]));
  };
  B.patchOf = function (m, extra) {
    if (m && m.patch) return majorOf(m.patch);
    const d = (m && m.date) || ''; let cur = '';
    (extra && extra.length ? [...CAL_SORTED, ...extra].sort((a, b) => a[1].localeCompare(b[1])) : CAL_SORTED).forEach(([p, dt]) => { if (dt <= d) cur = p; });
    return majorOf(cur);
  };

  // ── decayed counters (rolling, recency-weighted) ──
  function Dec(half) { this.v = 0; this.t = 0; this.h = half; }
  Dec.prototype.at = function (t) { return this.t ? this.v * Math.pow(0.5, Math.max(0, t - this.t) / (this.h * DAY)) : 0; };
  Dec.prototype.add = function (t, x) { this.v = this.at(t) + x; this.t = t; };
  const dget = (o, k, half) => o[k] || (o[k] = new Dec(half));

  function profiles(opts) { return (opts && opts.profiles) || root.WHeroProfile; }
  const sideTeam = (m, s) => (s === 'blue' ? m.blueTeam : m.redTeam);
  const other = s => (s === 'blue' ? 'red' : 'blue');
  const laneOrdered = ps => ps.length === 5 && ps.map(p => p && p.lane).join(',') === LANES.join(',');
  const usable = m => m && m.blueTeam && m.redTeam && (m.winner === 'blue' || m.winner === 'red') && (m.bluePicks || []).length === 5 && (m.redPicks || []).length === 5
    && (m.blueBans || []).length >= 3 && (m.redBans || []).length >= 3 && !laneOrdered(m.bluePicks) && !laneOrdered(m.redPicks) && m.pickOrder !== 'lane' && m.league !== 'Scrims';

  // ── Rolling world state: everything known BEFORE a given draft ──
  function World(opts) {
    this.HP = profiles(opts); this.rel = opts.relations || {};
    this.G = new Dec(90); this.G21 = new Dec(21);
    this.pick = {}; this.ban = {}; this.early = {}; this.win = {}; this.app = {}; this.pres21 = {};
    this.team = {}; this.first = {}; this.player = {}; this.lanePlayer = {}; this.laneSlot = {}; this.heroLane = {};
    this.teamLanePool = {}; this.slot = {};
    this.heroes = new Set(Object.keys(this.HP ? this.HP.data : {}));
  }
  World.prototype.prio = function (h, t) { const g = this.G.at(t) || 1; return Math.min(1, (this.early[h] ? this.early[h].at(t) : 0) / g); };
  World.prototype.pres = function (h, t) { const g = this.G.at(t) || 1; return Math.min(1, ((this.pick[h] ? this.pick[h].at(t) : 0) + (this.ban[h] ? this.ban[h].at(t) : 0)) / g); };
  World.prototype.banRate = function (h, t) { const g = this.G.at(t) || 1; return Math.min(1, (this.ban[h] ? this.ban[h].at(t) : 0) / g); };
  World.prototype.wr = function (h, t) { const p = this.pick[h] ? this.pick[h].at(t) : 0, w = this.win[h] ? this.win[h].at(t) : 0; return (w + 3) / (p + 6); };
  World.prototype.trend = function (h, t) { const g = this.G21.at(t); if (g < 4) return 0; return Math.min(1, (this.pres21[h] ? this.pres21[h].at(t) : 0) / g) - this.pres(h, t); };
  World.prototype.tc = function (team, h, t) { const T = this.team[team]; return T && T[h] ? T[h].at(t) : 0; };
  World.prototype.firstC = function (team, h, t) { const T = this.first[team]; return T && T[h] ? T[h].at(t) : 0; };
  World.prototype.lanesOf = function (h) {
    const L = this.heroLane[h]; if (L) { const tot = Object.values(L).reduce((a, b) => a + b, 0); const ls = Object.keys(L).filter(l => L[l] / tot >= 0.15 || L[l] >= 3); if (ls.length) return ls; }
    return [];
  };
  World.prototype.mainPlayer = function (team, lane) {
    const T = this.lanePlayer[team + '|' + lane]; if (!T) return '';
    return Object.keys(T).sort((a, b) => T[b] - T[a])[0] || '';
  };
  // how often THIS team takes this hero at this exact slot (smoothed toward their overall use)
  World.prototype.slotHabit = function (team, kind, side, i, h, t) {
    const S = this.slot[team + '|' + kind + '|' + side + '|' + i]; const tot = S ? Object.values(S).reduce((a, b) => a + b, 0) : 0;
    const T = kind === 'pick' ? this.team[team] : null;
    const any = T && T[h] ? T[h].at(t) : 0, anyTot = T ? Object.keys(T).reduce((s, k) => s + T[k].at(t), 0) : 0;
    const base = anyTot ? any / anyTot : 0;
    return ((S && S[h]) || 0) / (tot + 3) + base * 3 / (tot + 3);
  };
  World.prototype.pc = function (player, h, t) { const P = this.player[player]; return P && P[h] ? P[h].at(t) : 0; };
  World.prototype.update = function (m) {
    const t = Date.parse(m.date) || 0;
    this.G.add(t, 1); this.G21.add(t, 1);
    ['blue', 'red'].forEach(s => {
      const team = sideTeam(m, s), win = m.winner === s;
      (m[s + 'Picks'] || []).forEach((p, i) => {
        const h = nm(p); if (!h) return; this.heroes.add(h);
        { const K = team + '|pick|' + s + '|' + i, S = this.slot[K] || (this.slot[K] = {}); S[h] = (S[h] || 0) + 1; }
        dget(this.pick, h, 90).add(t, 1); if (win) dget(this.win, h, 90).add(t, 1); dget(this.pres21, h, 21).add(t, 1);
        const T = this.team[team] || (this.team[team] = {}); dget(T, h, 150).add(t, 1);
        if ((s === 'blue' && i === 0) || (s === 'red' && i <= 1)) { const F = this.first[team] || (this.first[team] = {}); dget(F, h, 150).add(t, 1); }
        if (i <= 2) dget(this.early, h, 90).add(t, 1);
        if (p.lane) {
          const L = this.heroLane[h] || (this.heroLane[h] = {}); L[p.lane] = (L[p.lane] || 0) + 1;
          const LS = this.laneSlot[team + '|' + s] || (this.laneSlot[team + '|' + s] = [{}, {}, {}, {}, {}]); LS[i][p.lane] = (LS[i][p.lane] || 0) + 1;
          const TP = this.teamLanePool[team + '|' + p.lane] || (this.teamLanePool[team + '|' + p.lane] = {}); TP[h] = (TP[h] || 0) + 1;
          if (p.player) {
            const LP = this.lanePlayer[team + '|' + p.lane] || (this.lanePlayer[team + '|' + p.lane] = {}); LP[p.player] = (LP[p.player] || 0) + 1;
            const P2 = this.player[p.player] || (this.player[p.player] = {}); dget(P2, h, 150).add(t, 1);
          }
        }
      });
      (m[s + 'Bans'] || []).forEach((b, i) => { const h = nm(b); if (!h) return; this.heroes.add(h);
        { const K = team + '|ban|' + s + '|' + i, S = this.slot[K] || (this.slot[K] = {}); S[h] = (S[h] || 0) + 1; } dget(this.ban, h, 90).add(t, 1); dget(this.pres21, h, 21).add(t, 1); if (i <= 2) dget(this.early, h, 90).add(t, 0.6); });
    });
  };

  // counter matrix (profile game sense + curated counters), cached
  function counterFn(world) {
    const cache = new Map();
    return (a, b) => {
      let row = cache.get(a); if (!row) { row = new Map(); cache.set(a, row); }
      let v = row.get(b); if (v !== undefined) return v;
      v = world.HP ? world.HP.counter(a, b) : 0;
      const r = world.rel[b]; if (r && (r.counter || []).includes(a)) v += 1;
      row.set(b, v); return v;
    };
  }

  // ── Features for the plausible candidates at one decision ──
  // A cheap pre-score keeps the top TOPK (plus the actual choice when training);
  // rows carry a compact Float32Array in PICK_F / BAN_F order.
  function featuresAt(world, ctr, st, must) {
    const { t, kind, side, team, opp, mine, theirs, taken, slot, gi } = st;
    const HP = world.HP;
    const openMine = LANES.filter(l => !mine.some(p => p.lane === l));
    const openTheirs = LANES.filter(l => !theirs.some(p => p.lane === l));
    const avail = [...world.heroes].filter(h => !taken.has(h));
    const pre = [];
    avail.forEach(h => {
      const lanes = world.lanesOf(h);
      if (kind === 'pick') {
        const fit = lanes.length ? lanes.filter(l => openMine.includes(l)) : openMine.slice(0, 1);
        if (!fit.length && h !== must) return;
        const cheap = world.prio(h, t) + world.pres(h, t) + 0.5 * Math.log1p(world.tc(team, h, t)) + 0.3 * Math.log1p(world.tc(opp, h, t)) + 0.3 * theirs.reduce((s2, e) => s2 + ctr(h, nm(e)), 0);
        pre.push({ h, lanes, fit: fit.length ? fit : openMine.slice(0, 1), cheap });
      } else {
        const cheap = world.banRate(h, t) + world.prio(h, t) + 0.5 * Math.log1p(world.tc(opp, h, t)) + 0.4 * Math.log1p(world.firstC(opp, h, t));
        pre.push({ h, lanes, cheap });
      }
    });
    pre.sort((a2, b2) => b2.cheap - a2.cheap);
    const keep = pre.slice(0, TOPK);
    if (must && !keep.some(r => r.h === must)) { const m2 = pre.find(r => r.h === must); if (m2) keep.push(m2); }
    const pool = avail.map(h => [h, world.prio(h, t) + world.pres(h, t)]).sort((a2, b2) => b2[1] - a2[1]).slice(0, 35);
    const ourCore = kind === 'ban' ? Object.keys(world.team[team] || {}).map(k => [k, world.tc(team, k, t)]).sort((a2, b2) => b2[1] - a2[1]).slice(0, 5).map(x2 => x2[0]) : [];
    const threatTo = [...new Set([...ourCore, ...mine.map(nm)])];
    const LS = world.laneSlot[team + '|' + side]; const ls = LS ? LS[slot] : null; const lsTot = ls ? Object.values(ls).reduce((a2, b2) => a2 + b2, 0) : 0;
    return keep.map(({ h, lanes, fit }) => {
      if (kind === 'pick') {
        const lane = fit[0];
        const pl = world.mainPlayer(team, lane);
        const tcv = world.tc(team, h, t);
        let br = 0; pool.forEach(([c, w]) => { if (c !== h) br += ctr(c, h) * w; });
        const v = new Float32Array([
          world.prio(h, t), world.pres(h, t), world.trend(h, t), world.wr(h, t) - 0.5,
          Math.log1p(tcv), pl ? Math.log1p(world.pc(pl, h, t)) : 0, Math.log1p(world.tc(opp, h, t)),
          theirs.reduce((s2, e) => s2 + ctr(h, nm(e)), 0), -br / 10,
          mine.reduce((s2, m2) => s2 + (HP ? HP.synergy(h, nm(m2)) : 0) + (((world.rel[h] || {}).synergy || []).includes(nm(m2)) ? 0.5 : 0), 0),
          HP ? HP.fixes(mine.map(nm), h) : 0, Math.max(0, fit.length - 1) * (gi <= 1 ? 1 : 0.3),
          lsTot ? (ls[lane] || 0) / lsTot : 0.2, tcv < 0.5 && world.pres(h, t) < 0.05 ? 1 : 0, world.slotHabit(team, 'pick', side, slot, h, t)]);
        return { h, lane, v };
      }
      const eLane = lanes.find(l => openTheirs.includes(l)) || lanes[0] || '';
      const pool2 = eLane ? world.teamLanePool[opp + '|' + eLane] : null; const p2tot = pool2 ? Object.values(pool2).reduce((a2, b2) => a2 + b2, 0) : 0;
      const v = new Float32Array([
        world.prio(h, t), world.banRate(h, t), world.trend(h, t), world.wr(h, t) - 0.5,
        Math.log1p(world.tc(opp, h, t)), Math.log1p(world.firstC(opp, h, t)),
        threatTo.reduce((s2, c) => s2 + ctr(h, c), 0), Math.log1p(world.tc(team, h, t)),
        theirs.length ? (lanes.some(l => openTheirs.includes(l)) ? 1 : -1) : 0,
        p2tot >= 4 && pool2[h] ? pool2[h] / p2tot : 0, world.slotHabit(team, 'ban', side, slot, h, t)]);
      return { h, lane: eLane, v };
    });
  }

  // Replay one game → its 20 decisions (features of all candidates + the actual choice)
  function decisionsOf(world, ctr, m, keep) {
    const t = Date.parse(m.date) || 0, out = [];
    const st = { bluePicks: [], redPicks: [], blueBans: [], redBans: [] };
    ORDER.forEach(([kind, side, slot], i) => {
      const arr = kind === 'pick' ? m[side + 'Picks'] : m[side + 'Bans'];
      const actual = arr && arr[slot] ? arr[slot] : null; if (!actual) return;
      const h = nm(actual);
      const taken = new Set([...st.bluePicks, ...st.redPicks, ...st.blueBans, ...st.redBans].map(nm));
      if (keep && !taken.has(h)) {
        const rows = featuresAt(world, ctr, { t, kind, side, idx: i, team: sideTeam(m, side), opp: sideTeam(m, other(side)), mine: st[side + 'Picks'], theirs: st[other(side) + 'Picks'], taken, slot, gi: ['pick1', 'pick2', 'pick3', 'pick4'].indexOf(GROUP(i)) }, h);
        const a = rows.findIndex(r => r.h === h);
        if (a >= 0 && rows.length > 1) out.push({ i, g: GROUP(i), kind, side, team: sideTeam(m, side), opp: sideTeam(m, other(side)), actual: h, a, rows, t, game: m.id });
      }
      if (kind === 'pick') st[side + 'Picks'].push(typeof actual === 'string' ? { name: actual } : actual);
      else st[side + 'Bans'].push(h);
    });
    return out;
  }

  // ── conditional-logit fit per group (Adam, L2), with feature standardisation ──
  const featsOf = g => (g.startsWith('ban') ? BAN_F : PICK_F);
  // Weights start from "pros take what's prioritised" (presence / priority) and
  // the data has to earn every other reason: L2 pulls toward this prior, not 0.
  const PRIOR_W = { prio: 0.4, pres: 0.8, banRate: 0.8 };
  let LAMBDA = 0.05;
  function fitGroup(decs, F, iters, warm) {
    const n = F.length, mu = new Float64Array(n), sd = new Float64Array(n);
    let cnt = 0;
    decs.forEach(d => d.rows.forEach(r => { for (let k = 0; k < n; k++) mu[k] += r.v[k]; cnt++; }));
    for (let k = 0; k < n; k++) mu[k] /= cnt || 1;
    decs.forEach(d => d.rows.forEach(r => { for (let k = 0; k < n; k++) { const v = r.v[k] - mu[k]; sd[k] += v * v; } }));
    for (let k = 0; k < n; k++) sd[k] = Math.sqrt(sd[k] / (cnt || 1)) || 1;
    const X = decs.map(d => { const a = new Float64Array(d.rows.length * n); d.rows.forEach((r, j) => { for (let k = 0; k < n; k++) a[j * n + k] = (r.v[k] - mu[k]) / sd[k]; }); return { a, m: d.rows.length, y: d.a }; });
    const pri = Float64Array.from(F.map(f => PRIOR_W[f] || 0));
    const w = Float64Array.from(warm ? warm.w : pri), m1 = new Float64Array(n), m2 = new Float64Array(n), g = new Float64Array(n);
    const lam = LAMBDA, lr = 0.08;
    const s = new Float64Array(TOPK + 2);
    for (let it = 1; it <= iters; it++) {
      g.fill(0);
      X.forEach(({ a, m, y }) => {
        let mx = -1e9;
        for (let j = 0; j < m; j++) { let z = 0; for (let k = 0; k < n; k++) z += w[k] * a[j * n + k]; s[j] = z; if (z > mx) mx = z; }
        let Z = 0; for (let j = 0; j < m; j++) { s[j] = Math.exp(s[j] - mx); Z += s[j]; }
        for (let j = 0; j < m; j++) { const p = s[j] / Z, c = p - (j === y ? 1 : 0); if (Math.abs(c) < 1e-9) continue; for (let k = 0; k < n; k++) g[k] += c * a[j * n + k]; }
      });
      const N = X.length || 1;
      for (let k = 0; k < n; k++) {
        const gk = g[k] / N + lam * (w[k] - pri[k]);
        m1[k] = 0.9 * m1[k] + 0.1 * gk; m2[k] = 0.999 * m2[k] + 0.001 * gk * gk;
        w[k] -= lr * (m1[k] / (1 - Math.pow(0.9, it))) / (Math.sqrt(m2[k] / (1 - Math.pow(0.999, it))) + 1e-8);
      }
    }
    return { F, w: Array.from(w), mu: Array.from(mu), sd: Array.from(sd) };
  }
  function scoreRows(model, rows) {
    const { F, w, mu, sd } = model;
    const z = rows.map(r => F.reduce((s, f, k) => s + w[k] * ((r.v[k] - mu[k]) / sd[k]), 0));
    const mx = Math.max(...z); const e = z.map(v => Math.exp(v - mx)); const Z = e.reduce((a, b) => a + b, 0) || 1;
    return e.map(v => v / Z);
  }
  // Why: each feature's push on the chosen hero vs the expected alternative.
  function why(model, rows, j, probs) {
    const { F, w, mu, sd } = model;
    const out = F.map((f, k) => {
      const xs = rows.map(r => (r.v[k] - mu[k]) / sd[k]);
      const avg = xs.reduce((s, v, i) => s + v * probs[i], 0);
      const c = w[k] * (xs[j] - avg);
      // a reason = a feature the chosen hero has MORE of, that this phase rewards
      return { f, fam: FAMILY[f] || f, c: (w[k] > 0.02 && xs[j] > avg && !NOT_REASON.has(f)) ? c : 0 };
    }).sort((a, b) => b.c - a.c);
    const fam = {}; out.forEach(o => { if (o.c > 0) fam[o.fam] = (fam[o.fam] || 0) + o.c; });
    return { top: out.filter(o => o.c > 0.05).slice(0, 3), fam };
  }

  // ── Build ──
  B.build = function (matches, opts) {
    if (opts && opts.calendar && opts.calendar.length) B.setCalendar(opts.calendar);
    opts = opts || {};
    if (!opts.maxGames) opts.maxGames = 600;
    const t0 = Date.now();
    const games = (matches || []).filter(usable).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (Number(a.gameNum) || 0) - (Number(b.gameNum) || 0));
    const maxG = opts.maxGames || 900;
    const recent = games.slice(-maxG);
    const world = new World(opts), ctr = counterFn(world);
    // warm the world with older games we don't train on
    games.slice(0, games.length - recent.length).forEach(m => world.update(m));
    const decs = [];
    recent.forEach(m => { decisionsOf(world, ctr, m, true).forEach(d => decs.push(d)); world.update(m); });
    const groups = ['ban1', 'pick1', 'pick2', 'ban2', 'pick3', 'pick4'];
    const brain = { version: 1, n: recent.length, decisions: decs.length, models: {}, acc: {}, world, ctr, games: recent, meta: {} };
    if (recent.length < 12) { brain.meta.note = 'Needs at least 12 logged games with full draft order.'; return brain; }
    const iters = opts.iters || 70;
    // honest accuracy: fit on the older 80% of games, test on the newest 20%
    const cutT = recent[Math.floor(recent.length * 0.8)] ? Date.parse(recent[Math.floor(recent.length * 0.8)].date) : Infinity;
    groups.forEach(g => {
      const D = decs.filter(d => d.g === g), tr = D.filter(d => d.t < cutT), te = D.filter(d => d.t >= cutT);
      if (tr.length >= 8 && te.length >= 4) {
        const mdl = fitGroup(tr, featsOf(g), iters); brain.models['_' + g] = mdl;
        const acc = { n: te.length, top1: 0, top3: 0, top5: 0, pop3: 0, rnd3: 0 };
        te.forEach(d => {
          const p = scoreRows(mdl, d.rows), rank = p.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).findIndex(x => x[1] === d.a);
          if (rank === 0) acc.top1++; if (rank < 3) acc.top3++; if (rank < 5) acc.top5++;
          // baseline: rank by plain presence (pick+ban rate)
          const pr = d.rows.map((r, i) => [r.v[0] + r.v[1], i]).sort((a, b) => b[0] - a[0]).findIndex(x => x[1] === d.a);   // prio + presence/ban rate
          if (pr < 3) acc.pop3++;
          acc.rnd3 += Math.min(1, 3 / d.rows.length);
        });
        ['top1', 'top3', 'top5', 'pop3', 'rnd3'].forEach(k => { acc[k] = acc[k] / te.length; });
        brain.acc[g] = acc;
      }
      if (D.length >= 8) brain.models[g] = fitGroup(D, featsOf(g), brain.acc[g] ? Math.round(iters / 2) : iters, brain.acc[g] ? brain.models['_' + g] : null);
    });
    // labels for every decision (with the final models)
    decs.forEach(d => {
      const mdl = brain.models[d.g]; if (!mdl) return;
      const p = scoreRows(mdl, d.rows); const y = why(mdl, d.rows, d.a, p);
      d.p = p[d.a]; d.rank = p.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).findIndex(x => x[1] === d.a);
      d.why = y.top; d.fam = y.fam;
      d.label = Object.keys(y.fam).sort((a, b) => y.fam[b] - y.fam[a])[0] || (d.rank > 5 ? 'off-script' : 'standard');
      if (d.kind === 'pick' && d.rows[d.a].v[13] === 1) d.label = 'pocket pick';
      d.rows = null;                                    // free memory — keep only what explanations need
    });
    brain.decs = decs;
    brain.types = clusterDrafts(recent, world.HP, opts.k);
    brain.shifts = patchShifts(recent);
    brain.meta.ms = Date.now() - t0;
    return brain;
  };

  // ── Live prediction for a draft state ──
  B.predict = function (brain, draft, team, opp, side, kind) {
    const world = brain.world, t = Date.now();
    const st = { bluePicks: (draft.bluePicks || []).map(p => (typeof p === 'string' ? { name: p } : p)), redPicks: (draft.redPicks || []).map(p => (typeof p === 'string' ? { name: p } : p)) };
    const taken = new Set([...st.bluePicks, ...st.redPicks].map(nm).concat(draft.blueBans || [], draft.redBans || []));
    const nb = (draft[side + 'Bans'] || []).length, np = st[side + 'Picks'].length;
    let idx = -1; const cnt = { 'ban|blue': 0, 'ban|red': 0, 'pick|blue': 0, 'pick|red': 0 };
    ORDER.forEach(([k, s], i) => { if (idx >= 0) return; const c = cnt[k + '|' + s]; if (k === kind && s === side && c === (kind === 'ban' ? nb : np)) idx = i; cnt[k + '|' + s]++; });
    if (idx < 0) return { list: [] };
    const g = GROUP(idx), mdl = brain.models[g]; if (!mdl) return { list: [], group: g };
    const rows = featuresAt(world, brain.ctr, { t: Date.parse((brain.games[brain.games.length - 1] || {}).date) || t, kind, side, idx, team, opp, mine: st[side + 'Picks'], theirs: st[other(side) + 'Picks'], taken, slot: kind === 'ban' ? nb : np, gi: ['pick1', 'pick2', 'pick3', 'pick4'].indexOf(g) });
    const p = scoreRows(mdl, rows);
    const list = rows.map((r, j) => ({ hero: r.h, lane: r.lane, p: p[j], j })).sort((a, b) => b.p - a.p).slice(0, 8);
    list.forEach(o => { const y = why(mdl, rows, o.j, p); o.why = y.top.map(x => FAMILY[x.f] || x.f); o.fam = y.fam; });
    return { group: g, groupLabel: GROUP_LABEL[g], list };
  };

  // ── Explain a real game: every decision with its reason ──
  B.explainGame = function (brain, gameId) {
    return (brain.decs || []).filter(d => d.game === gameId).map(d => ({ step: d.i + 1, kind: d.kind, side: d.side, team: d.team, hero: d.actual, label: d.label, p: d.p, rank: d.rank,
      why: [...new Set((d.why || []).map(w => FAMILY[w.f] || w.f))] }));
  };

  // ── Worker support: build off the main thread, then rebuild the rolling
  //    world locally (cheap) so live predictions work ──
  B.usable = usable;
  B.lite = function (brain) {
    const models = {}; Object.keys(brain.models || {}).forEach(k => { if (k[0] !== '_') models[k] = brain.models[k]; });
    return { version: brain.version, n: brain.n, decisions: brain.decisions, models, acc: brain.acc, decs: brain.decs, types: brain.types, shifts: brain.shifts, meta: brain.meta,
      gameIds: (brain.games || []).map(g => g.id) };
  };
  B.hydrate = function (lite, matches, opts) {
    opts = opts || {};
    const games = (matches || []).filter(usable).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (Number(a.gameNum) || 0) - (Number(b.gameNum) || 0));
    const world = new World(opts); games.forEach(m => world.update(m));
    const recent = games.slice(-(opts.maxGames || 600));
    return { ...lite, world, ctr: counterFn(world), games: recent };
  };
  B.buildAsync = function (matches, opts) {
    opts = opts || {};
    const ms = (matches || []).filter(usable);
    return new Promise(resolve => {
      let done = false;
      const fallback = () => { if (done) return; done = true; setTimeout(() => resolve(B.build(ms, opts)), 0); };
      try {
        if (typeof Worker === 'undefined' || opts.noWorker) return fallback();
        const w = new Worker('warr-brain-worker.js?v=3');
        const timer = setTimeout(() => { try { w.terminate(); } catch (_) {} fallback(); }, 45000);
        w.onmessage = e => {
          if (done) return; clearTimeout(timer); try { w.terminate(); } catch (_) {}
          if (!e.data || e.data.error) return fallback();
          done = true; resolve(B.hydrate(e.data, ms, opts));
        };
        w.onerror = () => { clearTimeout(timer); try { w.terminate(); } catch (_) {} fallback(); };
        w.postMessage({ matches: ms, opts: { relations: opts.relations || {}, maxGames: opts.maxGames, k: opts.k, calendar: opts.calendar || EXTRA_CAL, kitProfiles: opts.kitProfiles || null } });
      } catch (_) { fallback(); }
    });
  };

  // ── How a team thinks: reason mix vs the league, philosophy, draft types ──
  B.teamMind = function (brain, team) {
    const all = brain.decs || [], mine = all.filter(d => d.team === team && d.label);
    if (!mine.length) return null;
    const mix = (ds, kind) => { const c = {}; let n = 0; ds.filter(d => d.kind === kind).forEach(d => { c[d.label] = (c[d.label] || 0) + 1; n++; }); Object.keys(c).forEach(k => { c[k] /= n || 1; }); return { c, n }; };
    const tp = mix(mine, 'pick'), lp = mix(all, 'pick'), tb = mix(mine, 'ban'), lb = mix(all, 'ban');
    const diff = (a, b) => Object.keys({ ...a.c, ...b.c }).map(k => ({ label: k, team: a.c[k] || 0, league: b.c[k] || 0, d: (a.c[k] || 0) - (b.c[k] || 0) })).sort((x, y) => y.team - x.team);
    // philosophy scores (team vs league average), from the decisions' own feature pushes
    const famAvg = (ds, fam) => { let s = 0, n = 0; ds.forEach(d => { if (d.fam) { s += d.fam[fam] || 0; n++; } }); return n ? s / n : 0; };
    const P = (label, fam, kind, slotFilter) => {
      const a = mine.filter(d => d.kind === kind && (!slotFilter || slotFilter(d))), b = all.filter(d => d.kind === kind && (!slotFilter || slotFilter(d)));
      const ta = famAvg(a, fam), lb2 = famAvg(b, fam);
      return { label, team: ta, league: lb2, ratio: lb2 ? ta / lb2 : 0, n: a.length };
    };
    const early = d => d.g === 'pick1' || d.g === 'pick2', late = d => d.g === 'pick3' || d.g === 'pick4';
    const philosophy = [
      P('Plays for power picks', 'power', 'pick', early), P('Relies on comfort heroes', 'comfort', 'pick'), P('Drafts through its players', 'player comfort', 'pick'),
      P('Counter-picks late', 'counter', 'pick', late), P('Picks blind-safe early', 'safe blind', 'pick', early), P('Builds synergy / combos', 'synergy', 'pick'),
      P('Fixes the comp', 'comp fix', 'pick'), P('Steals the enemy\'s heroes', 'deny', 'pick'), P('Uses flex to hide lanes', 'flex / hide', 'pick', early),
      P('Bans the meta', 'meta ban', 'ban'), P('Bans to target the opponent', 'target ban', 'ban'), P('Bans to protect itself', 'protect ban', 'ban'),
    ];
    // predictability: how well the expert brain predicted this team's picks
    const ranks = mine.filter(d => d.kind === 'pick' && d.rank != null), top3 = ranks.filter(d => d.rank < 3).length / (ranks.length || 1);
    const pockets = mine.filter(d => d.label === 'pocket pick').map(d => d.actual);
    // draft types this team uses
    const T = brain.types; const tm = {};
    if (T && T.assign) T.assign.filter(a => a.team === team).forEach(a => { tm[a.k] = (tm[a.k] || 0) + 1; });
    const nT = Object.values(tm).reduce((a, b) => a + b, 0) || 1;
    const types = Object.keys(tm).map(k => ({ type: T.clusters[k].name, share: tm[k] / nT, wr: T.clusters[k].wr })).sort((a, b) => b.share - a.share);
    return { team, picks: diff(tp, lp), bans: diff(tb, lb), nPicks: tp.n, nBans: tb.n, philosophy, predictable: top3, pockets: [...new Set(pockets)], types };
  };

  // ── Draft types: cluster every team-draft by what its 5 heroes do ──
  function compVec(HP, heroes) {
    const c = HP.comp(heroes), n = c.n || 1;
    const tagc = tag => heroes.filter(h => HP.has(h, tag)).length / n;
    return [c.en / n, c.cc / n, c.mob, c.rng, c.sus / n, c.tank / n, c.bur / n, c.dps / n, c.poke / n, c.wave / n, c.early / n, c.late / n, c.phys / n,
      tagc('dive') + tagc('pickoff') * 0.5, tagc('teamfight'), tagc('poke'), tagc('scale'), tagc('split')];
  }
  const VEC_NAMES = ['engage', 'crowd control', 'mobility', 'range', 'sustain', 'frontline', 'burst', 'sustained damage', 'poke', 'push', 'early power', 'late scaling', 'physical damage', 'dive', 'teamfight', 'poke comp', 'scaling', 'split push'];
  const NAME_OF = { 'engage': 'engage', 'crowd control': 'lockdown', 'mobility': 'mobile', 'range': 'long range', 'sustain': 'sustain', 'frontline': 'frontline', 'burst': 'burst', 'sustained damage': 'DPS', 'poke': 'poke', 'push': 'push', 'early power': 'early tempo', 'late scaling': 'late game', 'physical damage': 'physical', 'dive': 'dive', 'teamfight': 'teamfight', 'poke comp': 'poke', 'scaling': 'scaling', 'split push': 'split push' };
  function clusterDrafts(games, HP, kWant) {
    if (!HP || games.length < 10) return null;
    const pts = [];
    games.forEach(m => ['blue', 'red'].forEach(s => { const hs = (m[s + 'Picks'] || []).map(nm).filter(Boolean); if (hs.length === 5) pts.push({ v: compVec(HP, hs), team: sideTeam(m, s), win: m.winner === s, opp: sideTeam(m, other(s)), game: m.id, side: s }); }));
    const D = pts[0].v.length, mu = Array(D).fill(0), sd = Array(D).fill(0);
    pts.forEach(p => p.v.forEach((x, i) => { mu[i] += x / pts.length; }));
    pts.forEach(p => p.v.forEach((x, i) => { sd[i] += (x - mu[i]) ** 2 / pts.length; }));
    for (let i = 0; i < D; i++) sd[i] = Math.sqrt(sd[i]) || 1;
    pts.forEach(p => { p.z = p.v.map((x, i) => (x - mu[i]) / sd[i]); });
    const dist = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
    const kmeans = k => {
      let cent = [pts[0].z.slice()];                      // k-means++ seeding (deterministic: farthest point)
      while (cent.length < k) { let best = null, bd = -1; pts.forEach(p => { const d = Math.min(...cent.map(c => dist(p.z, c))); if (d > bd) { bd = d; best = p; } }); cent.push(best.z.slice()); }
      let asg = [];
      for (let it = 0; it < 30; it++) {
        asg = pts.map(p => { let bi = 0, bd = Infinity; cent.forEach((c, i) => { const d = dist(p.z, c); if (d < bd) { bd = d; bi = i; } }); return bi; });
        cent = cent.map((c, i) => { const mem = pts.filter((_, j) => asg[j] === i); if (!mem.length) return c; return c.map((_, d) => mem.reduce((s, p) => s + p.z[d], 0) / mem.length); });
      }
      // silhouette (sampled)
      const S = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 150)) === 0);
      let sil = 0;
      S.forEach(p => {
        const i = pts.indexOf(p), own = asg[i];
        const avgTo = c => { const mem = pts.filter((_, j) => asg[j] === c && j !== i); return mem.length ? mem.reduce((s, q) => s + Math.sqrt(dist(p.z, q.z)), 0) / mem.length : 0; };
        const a = avgTo(own); let b = Infinity; cent.forEach((_, c) => { if (c !== own) b = Math.min(b, avgTo(c)); });
        sil += (b - a) / Math.max(a, b, 1e-9);
      });
      return { k, cent, asg, sil: sil / S.length };
    };
    const ks = kWant ? [kWant] : [3, 4, 5, 6].filter(k => pts.length >= k * 8);
    const best = ks.map(kmeans).sort((a, b) => b.sil - a.sil)[0];
    const clusters = best.cent.map((c, i) => {
      const mem = pts.filter((_, j) => best.asg[j] === i);
      const top = c.map((v, d) => [VEC_NAMES[d], v]).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 0.3).slice(0, 3).map(x => NAME_OF[x[0]]);
      const low = c.map((v, d) => [VEC_NAMES[d], v]).sort((a, b) => a[1] - b[1]).filter(x => x[1] < -0.5).slice(0, 1).map(x => 'low ' + NAME_OF[x[0]]);
      const w = mem.filter(p => p.win).length;
      return { name: [...new Set(top)].join(' · ') + (low.length ? ` (${low[0]})` : '') || 'balanced', n: mem.length, wr: (w + 2) / (mem.length + 4), rawW: w, share: mem.length / pts.length,
        examples: Object.entries(mem.flatMap(p => (games.find(g => g.id === p.game)[p.side + 'Picks'] || []).map(nm)).reduce((o, h) => { o[h] = (o[h] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]) };
    });
    // type-vs-type results
    const vs = {};
    const byGame = {}; pts.forEach((p, j) => { (byGame[p.game] = byGame[p.game] || []).push({ ...p, k: best.asg[j] }); });
    Object.values(byGame).forEach(pair => { if (pair.length !== 2) return; const [a, b] = pair; const key = a.k + '|' + b.k; const x = vs[key] || (vs[key] = { g: 0, w: 0 }); x.g++; if (a.win) x.w++; const key2 = b.k + '|' + a.k; const y = vs[key2] || (vs[key2] = { g: 0, w: 0 }); y.g++; if (b.win) y.w++; });
    return { k: best.k, silhouette: best.sil, clusters, vs, assign: pts.map((p, j) => ({ team: p.team, game: p.game, side: p.side, k: best.asg[j], win: p.win })) };
  }

  // ── Patch shifts: heroes whose presence jumped or dropped after the latest patch ──
  function patchShifts(games) {
    const byP = {}; games.forEach(m => { const p = B.patchOf(m); if (!p) return; (byP[p] = byP[p] || []).push(m); });
    const ps = Object.keys(byP).sort((a, b) => (byP[a][0].date || '').localeCompare(byP[b][0].date || ''));
    if (ps.length < 2) return { patch: ps[0] || '', list: [] };
    const cur = ps[ps.length - 1], prev = ps.slice(0, -1).slice(-2);
    const A = byP[cur], Bm = prev.flatMap(p => byP[p]);
    if (A.length < 8 || Bm.length < 8) return { patch: cur, list: [], note: `only ${A.length} games on ${cur} so far` };
    const pres = gs => { const c = {}; gs.forEach(m => ['blue', 'red'].forEach(s => [...(m[s + 'Picks'] || []), ...(m[s + 'Bans'] || [])].forEach(x => { const h = nm(x); c[h] = (c[h] || 0) + 1; }))); return c; };
    const pa = pres(A), pb = pres(Bm), out = [];
    new Set([...Object.keys(pa), ...Object.keys(pb)]).forEach(h => {
      const a = (pa[h] || 0) / A.length, b = (pb[h] || 0) / Bm.length;
      const pp = ((pa[h] || 0) + (pb[h] || 0)) / (A.length + Bm.length);
      const se = Math.sqrt(Math.max(1e-6, pp * (1 - Math.min(0.99, pp)) * (1 / A.length + 1 / Bm.length)));
      const z = (a - b) / se;
      if (Math.abs(z) >= 2 && Math.abs(a - b) >= 0.12) out.push({ hero: h, before: b, after: a, dir: a > b ? 'up' : 'down', z });
    });
    return { patch: cur, from: prev.join(' + '), list: out.sort((x, y) => Math.abs(y.z) - Math.abs(x.z)).slice(0, 12), nAfter: A.length };
  }

  B.report = function (brain) {
    const L = [];
    Object.keys(brain.acc).forEach(g => { const a = brain.acc[g]; L.push(`${GROUP_LABEL[g]}: top-1 ${Math.round(a.top1 * 100)}%, top-3 ${Math.round(a.top3 * 100)}% (presence alone ${Math.round(a.pop3 * 100)}%, random ${Math.round(a.rnd3 * 100)}%) over ${a.n} decisions`); });
    return L;
  };
  B.FAMILY = FAMILY; B.GROUP_LABEL = GROUP_LABEL; B.ORDER = ORDER;
  root.WBrain = B;
})(typeof window !== 'undefined' ? window : globalThis);
