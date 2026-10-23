// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — WIntel: data-driven matchup intelligence (shared, no API cost)
//
// Pure functions over an array of scout matches. Everything here is
// computed in the browser from the matches the page already loaded, so it
// works for every user (Members included) and is the evidence the Claude
// analysis is told to cite.
//
//   WIntel.ratings(matches)            opponent-adjusted team strength (Bradley–Terry
//                                       with a prior + blue-side term) → pGame / pSeries
//   WIntel.team(matches, team, R)      one team's profile: hero pool by lane, ban impact,
//                                       heroes that beat them, tempo (duration, first
//                                       turtle/blood, phases, side), form
//   WIntel.levers(intel)               "how to beat them" — ranked, each with evidence
//   WIntel.edges(intel)                what they are good at (respect list)
//   WIntel.meta(matches)               hero presence / WR in this pool (meta context)
//   WIntel.promptBlock(intel, levers)  compact text for an LLM prompt
//
// Small samples are shrunk toward a baseline and every number carries its
// game count, so 2-0 never reads as "100%".
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  const W = {};
  const nm = p => String((p && (p.name || p)) || '').trim();
  const sideOf = (m, t) => (m.blueTeam === t ? 'blue' : m.redTeam === t ? 'red' : null);
  const other = s => (s === 'blue' ? 'red' : 'blue');
  const sig = x => 1 / (1 + Math.exp(-x));
  const pct = x => Math.round(x * 100);
  const shrink = (w, n, base, k) => (w + base * k) / (n + k);
  W.LANES = ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'];
  // Two-proportion z (with +1 smoothing): how sure are we a1/n1 really beats a2/n2?
  W.z2 = function (a1, n1, a2, n2) {
    if (!n1 || !n2) return 0;
    const p1 = (a1 + 1) / (n1 + 2), p2 = (a2 + 1) / (n2 + 2), p = (a1 + a2 + 1) / (n1 + n2 + 2);
    const se = Math.sqrt(p * (1 - p) * (1 / (n1 + 2) + 1 / (n2 + 2)));
    return se ? (p1 - p2) / se : 0;
  };
  // Evidence label shown next to every lever.
  W.conf = z => (z >= 2 ? 'strong' : z >= 1.4 ? 'solid' : 'early signal');

  // "15:32" → 15.53 · "15" → 15 · 932 (seconds) → 15.53
  W.mins = function (d) {
    if (d == null || d === '') return null;
    if (typeof d === 'number') return d > 90 ? d / 60 : d;
    const s = String(d).trim();
    const m = s.match(/^(\d{1,2})[:.'m ]\s*(\d{1,2})/);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
    const n = parseFloat(s);
    return isFinite(n) ? (n > 90 ? n / 60 : n) : null;
  };

  // ── Opponent-adjusted team strength ────────────────────────────────────
  W.ratings = function (matches) {
    const ms = (matches || []).filter(m => m && m.blueTeam && m.redTeam && (m.winner === 'blue' || m.winner === 'red'));
    const r = Object.create(null), games = Object.create(null);
    ms.forEach(m => { r[m.blueTeam] = 0; r[m.redTeam] = 0; games[m.blueTeam] = (games[m.blueTeam] || 0) + 1; games[m.redTeam] = (games[m.redTeam] || 0) + 1; });
    let h = 0;                           // blue-side advantage (logit)
    const lam = 0.35;                    // prior: pulls thin-sample teams to average
    for (let it = 0; it < 120; it++) {
      const g = Object.create(null); let gh = 0;
      for (const t in r) g[t] = -lam * r[t];
      ms.forEach(m => {
        const y = m.winner === 'blue' ? 1 : 0;
        const p = sig(r[m.blueTeam] - r[m.redTeam] + h);
        g[m.blueTeam] += y - p; g[m.redTeam] -= y - p; gh += y - p;
      });
      for (const t in r) r[t] += 0.6 * g[t] / Math.max(1, games[t]);
      h += 0.3 * (gh - 2 * h) / Math.max(1, ms.length);
    }
    const mean = Object.values(r).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(r).length);
    for (const t in r) r[t] -= mean;
    const pGame = (a, b, aSide) => {
      const d = (r[a] || 0) - (r[b] || 0);
      return aSide === 'blue' ? sig(d + h) : aSide === 'red' ? sig(d - h) : sig(d);
    };
    const pSeries = (a, b, bo) => {
      const p = pGame(a, b), need = Math.ceil((bo || 1) / 2);
      let tot = 0, c = 1;
      for (let k = 0; k < need; k++) {
        if (k > 0) c = c * (need - 1 + k) / k;
        tot += c * Math.pow(p, need) * Math.pow(1 - p, k);
      }
      return tot;
    };
    const ranked = Object.keys(r).sort((a, b) => r[b] - r[a]);
    return { r, games, blueAdv: h, pGame, pSeries, rank: t => ranked.indexOf(t) + 1, teams: ranked.length, n: ms.length };
  };

  // ── One team's profile ─────────────────────────────────────────────────
  W.team = function (matches, team, R) {
    R = R || W.ratings(matches);
    const games = (matches || []).filter(m => m && sideOf(m, team) && (m.winner === 'blue' || m.winner === 'red'))
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const n = games.length;
    const I = { team, n, wins: 0, exp: 0, heroes: {}, lanes: {}, bannedBy: {}, avail: {}, vsHero: {}, firstPicks: {}, p1bans: {},
      side: { blue: { g: 0, w: 0 }, red: { g: 0, w: 0 } },
      fb: { g: 0, got: 0, wGot: 0, wMiss: 0 }, ft: { g: 0, got: 0, wGot: 0, wMiss: 0 },
      turtle: { ours: 0, all: 0 }, lord: { ours: 0, all: 0 }, towers: { g: 0, diff: 0 },
      dur: { win: [], loss: [], short: { g: 0, w: 0 }, mid: { g: 0, w: 0 }, long: { g: 0, w: 0 } },
      phase: { early: { g: 0, w: 0, conv: 0 }, mid: { g: 0, w: 0 }, late: { g: 0, w: 0 } },
      form: [], rating: R.r[team] || 0, rank: R.rank(team), teams: R.teams };
    if (!n) return I;
    games.forEach(m => {
      const s = sideOf(m, team), o = other(s), win = m.winner === s;
      const opp = s === 'blue' ? m.redTeam : m.blueTeam;
      const e = R.pGame(team, opp, s);
      if (win) I.wins++;
      I.exp += e;
      I.form.push(win ? 'W' : 'L');
      I.side[s].g++; if (win) I.side[s].w++;
      const mine = (m[s + 'Picks'] || []), theirs = (m[o + 'Picks'] || []);
      const myBans = (m[s + 'Bans'] || []).map(nm), oppBans = (m[o + 'Bans'] || []).map(nm);
      const allBans = new Set([...myBans, ...oppBans]);
      mine.forEach((p, i) => {
        const h = nm(p); if (!h) return;
        const H = I.heroes[h] || (I.heroes[h] = { g: 0, w: 0, lanes: {}, players: {} });
        H.g++; if (win) H.w++;
        const ln = p && p.lane; if (ln) H.lanes[ln] = (H.lanes[ln] || 0) + 1;
        const pl = p && p.player; if (pl) H.players[pl] = (H.players[pl] || 0) + 1;
        if (ln) {
          const L = I.lanes[ln] || (I.lanes[ln] = { g: 0, heroes: {}, players: {} });
          L.g++; L.heroes[h] = L.heroes[h] || { g: 0, w: 0 }; L.heroes[h].g++; if (win) L.heroes[h].w++;
          if (pl) L.players[pl] = (L.players[pl] || 0) + 1;
        }
        if (i === 0) I.firstPicks[h] = (I.firstPicks[h] || 0) + 1;
      });
      myBans.slice(0, 3).forEach(b => { if (b) I.p1bans[b] = (I.p1bans[b] || 0) + 1; });
      oppBans.forEach(b => { if (!b) return; const B = I.bannedBy[b] || (I.bannedBy[b] = { g: 0, w: 0 }); B.g++; if (win) B.w++; });
      // availability record for every hero this team has ever picked (filled below)
      I._games = I._games || [];
      I._games.push({ win, bans: allBans, oppBans: new Set(oppBans), mine: new Set(mine.map(nm)) });
      theirs.forEach(p => {
        const h = nm(p); if (!h) return;
        const V = I.vsHero[h] || (I.vsHero[h] = { g: 0, oppW: 0, oppExp: 0 });
        V.g++; if (!win) V.oppW++; V.oppExp += 1 - e;
      });
      // tempo
      if (m.firstBlood === 'blue' || m.firstBlood === 'red') {
        I.fb.g++; if (m.firstBlood === s) { I.fb.got++; if (win) I.fb.wGot++; } else if (win) I.fb.wMiss++;
      }
      const obj = m.objectives || {};
      const tur = Array.isArray(obj.turtle) ? obj.turtle.filter(x => x === 'blue' || x === 'red') : [];
      const lor = Array.isArray(obj.lord) ? obj.lord.filter(x => x === 'blue' || x === 'red') : [];
      if (tur.length) {
        I.ft.g++; if (tur[0] === s) { I.ft.got++; if (win) I.ft.wGot++; } else if (win) I.ft.wMiss++;
        I.turtle.all += tur.length; I.turtle.ours += tur.filter(x => x === s).length;
      }
      if (lor.length) { I.lord.all += lor.length; I.lord.ours += lor.filter(x => x === s).length; }
      if (m.towers && m.towers.blue != null && m.towers.red != null) {
        I.towers.g++; I.towers.diff += (Number(m.towers[s]) || 0) - (Number(m.towers[o]) || 0);
      }
      const d = W.mins(m.duration);
      if (d && d > 3 && d < 60) {
        (win ? I.dur.win : I.dur.loss).push(d);
        const b = d < 14 ? I.dur.short : d <= 18 ? I.dur.mid : I.dur.long;
        b.g++; if (win) b.w++;
      }
      const pw = m.phaseWinners || {};
      ['early', 'mid', 'late'].forEach(ph => {
        if (pw[ph] === 'blue' || pw[ph] === 'red') { I.phase[ph].g++; if (pw[ph] === s) { I.phase[ph].w++; if (ph === 'early' && win) I.phase.early.conv++; } }
      });
    });
    I.wr = I.wins / n;
    // Ban impact: WR with the hero available vs WR when the OPPONENT banned it.
    // Only heroes they actually play when open count — banning a hero they
    // never pick tells you nothing, however lopsided the record looks.
    I.banImpact = [];
    const base = I.wr;
    const cand = new Set([...Object.keys(I.heroes).filter(h => I.heroes[h].g >= 3)]);
    cand.forEach(h => {
      let ag = 0, aw = 0, pg = 0, pw2 = 0;
      I._games.forEach(g => {
        if (!g.bans.has(h)) { ag++; if (g.win) aw++; if (g.mine.has(h)) { pg++; if (g.win) pw2++; } }
      });
      const B = I.bannedBy[h] || { g: 0, w: 0 };
      if (B.g < 3 || ag < 4 || pg < 3 || pg / ag < 0.2) return;
      const wrA = shrink(aw, ag, base, 3), wrB = shrink(B.w, B.g, base, 3);
      I.banImpact.push({ hero: h, availG: ag, availWR: aw / ag, bannedG: B.g, bannedWR: B.w / B.g, pickedG: pg, pickedWR: pw2 / pg,
        pickRate: pg / ag, impact: wrA - wrB, z: W.z2(aw, ag, B.w, B.g) });
    });
    I.banImpact.sort((a, b) => b.z - a.z);
    // Heroes that beat them: opponent wins with the hero vs what the opponents' strength predicts.
    I.beatenBy = Object.entries(I.vsHero).filter(([, v]) => v.g >= 3).map(([h, v]) => ({
      hero: h, g: v.g, oppW: v.oppW, oppWR: v.oppW / v.g, expWR: v.oppExp / v.g,
      lift: (v.oppW - v.oppExp) / (v.g + 3),
      z: (v.oppW - v.oppExp) / Math.sqrt(v.oppExp * (1 - v.oppExp / v.g) + 1.5),
    })).sort((a, b) => b.z - a.z);
    // Lane summaries
    W.LANES.forEach(ln => {
      const L = I.lanes[ln]; if (!L) return;
      const hs = Object.entries(L.heroes).sort((a, b) => b[1].g - a[1].g);
      const pl = Object.entries(L.players).sort((a, b) => b[1] - a[1])[0];
      L.top = hs.slice(0, 4).map(([h, v]) => ({ hero: h, g: v.g, w: v.w }));
      L.pool = hs.length; L.main = pl ? pl[0] : ''; L.mainG = pl ? pl[1] : 0;
      L.share2 = hs.slice(0, 2).reduce((a, [, v]) => a + v.g, 0) / Math.max(1, L.g);
    });
    I.signature = Object.entries(I.heroes).filter(([, v]) => v.g >= 3)
      .map(([h, v]) => ({ hero: h, g: v.g, w: v.w, wr: v.w / v.g, adj: shrink(v.w, v.g, base, 4) - base, lane: Object.entries(v.lanes).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }))
      .sort((a, b) => (b.g * 0.04 + b.adj) - (a.g * 0.04 + a.adj));
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    I.dur.avgWin = avg(I.dur.win); I.dur.avgLoss = avg(I.dur.loss);
    I.overExp = (I.wins - I.exp) / n;      // + = beating what their schedule predicts
    I.last5 = I.form.slice(-5); I.last10WR = I.form.slice(-10).filter(x => x === 'W').length / Math.min(10, n);
    delete I._games;
    return I;
  };

  const g = (n) => `${n}g`;
  // ── How to beat them — ranked levers, each with its evidence ──────────
  // Every lever carries a z-like evidence score; anything weaker than ~1 is
  // dropped (that's coin-flip territory) and the rest are labelled
  // strong / solid / early signal so a coach knows how hard to lean on it.
  W.levers = function (I) {
    const out = [];
    if (!I || !I.n) return out;
    const add = (o) => { if (o.z >= 1.0) out.push({ ...o, conf: W.conf(o.z), score: o.z * (o.w || 1) }); };
    I.banImpact.forEach(b => {
      if (b.impact < 0.08) return;
      add({ kind: 'ban', heroes: [b.hero], z: b.z, w: 1.15,
        text: `Ban ${b.hero}`,
        why: `${I.team} win ${pct(b.availWR)}% when ${b.hero} is open (${g(b.availG)}, picked ${pct(b.pickRate)}% of those) but ${pct(b.bannedWR)}% when it's banned (${g(b.bannedG)})` });
    });
    const banned = new Set(out.map(x => x.heroes[0]));
    I.signature.slice(0, 8).forEach(s => {
      if (banned.has(s.hero) || s.g < 4 || s.adj < 0.05) return;
      const z = (s.w - s.g * I.wr) / Math.sqrt(s.g * I.wr * (1 - I.wr) + 1.5);
      add({ kind: 'deny', heroes: [s.hero], z, w: 0.9,
        text: `Take away ${s.hero}${s.lane ? ' (' + s.lane + ')' : ''}`,
        why: `comfort pick — ${s.w}-${s.g - s.w} (${pct(s.wr)}%) in ${g(s.g)} vs ${pct(I.wr)}% overall` });
    });
    I.beatenBy.slice(0, 8).forEach(b => {
      if (b.g < 4 || b.lift < 0.05) return;
      add({ kind: 'pick', heroes: [b.hero], z: b.z, w: 1.0,
        text: `Pick ${b.hero} into them`,
        why: `opponents went ${b.oppW}-${b.g - b.oppW} with ${b.hero} vs ${I.team} (${pct(b.oppWR)}% — their strength predicted ${pct(b.expWR)}%)` });
    });
    const D = I.dur;
    if (D.short.g >= 3 && D.long.g >= 3) {
      const ws = D.short.w / D.short.g, wl = D.long.w / D.long.g;
      if (ws > wl) add({ kind: 'tempo', heroes: [], z: W.z2(D.short.w, D.short.g, D.long.w, D.long.g), w: 0.9,
        text: 'Drag the game long — scale and play past 18:00',
        why: `${pct(ws)}% in games under 14 min (${g(D.short.g)}) vs ${pct(wl)}% past 18 min (${g(D.long.g)})` });
      else add({ kind: 'tempo', heroes: [], z: W.z2(D.long.w, D.long.g, D.short.w, D.short.g), w: 0.9,
        text: 'End it early — snowball before 14:00',
        why: `${pct(wl)}% in games past 18 min (${g(D.long.g)}) vs ${pct(ws)}% under 14 min (${g(D.short.g)})` });
    }
    const conv = (o, label, verb) => {
      const miss = o.g - o.got;
      if (o.got < 3 || miss < 3) return;
      add({ kind: 'objective', heroes: [], z: W.z2(o.wGot, o.got, o.wMiss, miss), w: 0.8,
        text: `${verb} ${label}`, why: `${I.team} win ${pct(o.wGot / o.got)}% when they get ${label} (${g(o.got)}) vs ${pct(o.wMiss / miss)}% when they don't (${g(miss)})` });
    };
    conv(I.ft, 'first Turtle', 'Contest');
    conv(I.fb, 'First Blood', 'Deny');
    const ph = I.phase;
    if (ph.early.g >= 4 && ph.late.g >= 4 && ph.early.w / ph.early.g > ph.late.w / ph.late.g)
      add({ kind: 'tempo', heroes: [], z: W.z2(ph.early.w, ph.early.g, ph.late.w, ph.late.g), w: 0.8, text: 'Survive their early game, win late',
        why: `they win the early phase ${pct(ph.early.w / ph.early.g)}% of the time (${g(ph.early.g)}) but the late phase only ${pct(ph.late.w / ph.late.g)}% (${g(ph.late.g)})` });
    const sb = I.side.blue, sr = I.side.red;
    if (sb.g >= 4 && sr.g >= 4) {
      const b = sb.w / sb.g, r = sr.w / sr.g;
      add({ kind: 'side', heroes: [], z: Math.abs(W.z2(sb.w, sb.g, sr.w, sr.g)), w: 0.7,
        text: `Put them on ${b > r ? 'Red' : 'Blue'} side`, why: `${pct(b)}% on Blue (${g(sb.g)}) vs ${pct(r)}% on Red (${g(sr.g)})` });
    }
    W.LANES.forEach(ln => {
      const L = I.lanes[ln];
      if (!L || L.g < 6 || !L.top || L.top.length < 2 || L.share2 < 0.8) return;
      const two = L.top.slice(0, 2).map(x => x.hero);
      add({ kind: 'lane', heroes: two, z: 1.2 + (L.share2 - 0.8) * 4, w: 1.0,
        text: `Target their ${ln}${L.main ? ' (' + L.main + ')' : ''} pool`,
        why: `${two.join(' + ')} cover ${pct(L.share2)}% of their ${ln} games (${g(L.g)}) — ban both and they're off-comfort` });
    });
    if (I.last5.length >= 5 && I.last5.filter(x => x === 'L').length >= 4)
      add({ kind: 'form', heroes: [], z: 1.0, w: 0.6, text: 'They are cold right now', why: `lost ${I.last5.filter(x => x === 'L').length} of their last 5` });
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  };

  // ── What they are good at (respect list) ──────────────────────────────
  W.edges = function (I) {
    const out = [];
    if (!I || !I.n) return out;
    I.signature.slice(0, 3).forEach(s => { if (s.adj > 0.04) out.push(`${s.hero}${s.lane ? ' (' + s.lane + ')' : ''}: ${s.w}-${s.g - s.w} in ${g(s.g)}`); });
    if (I.overExp >= 0.08 && I.n >= 6) out.push(`Beating their schedule: ${pct(I.wr)}% vs ${pct(I.exp / I.n)}% expected (${g(I.n)})`);
    if (I.turtle.all >= 5 && I.turtle.ours / I.turtle.all >= 0.62) out.push(`Turtle control ${pct(I.turtle.ours / I.turtle.all)}% (${I.turtle.all} turtles)`);
    if (I.lord.all >= 4 && I.lord.ours / I.lord.all >= 0.62) out.push(`Lord control ${pct(I.lord.ours / I.lord.all)}% (${I.lord.all} lords)`);
    if (I.fb.g >= 5 && I.fb.got / I.fb.g >= 0.62) out.push(`First Blood ${pct(I.fb.got / I.fb.g)}% (${g(I.fb.g)})`);
    if (I.towers.g >= 4 && I.towers.diff / I.towers.g >= 2) out.push(`+${(I.towers.diff / I.towers.g).toFixed(1)} tower diff per game (${g(I.towers.g)})`);
    return out;
  };

  // ── Hero meta in this pool ─────────────────────────────────────────────
  W.meta = function (matches) {
    const ms = (matches || []).filter(m => m && (m.winner === 'blue' || m.winner === 'red'));
    const H = {};
    ms.forEach(m => ['blue', 'red'].forEach(s => {
      const win = m.winner === s;
      (m[s + 'Picks'] || []).forEach(p => { const h = nm(p); if (!h) return; const x = H[h] || (H[h] = { p: 0, b: 0, w: 0 }); x.p++; if (win) x.w++; });
      (m[s + 'Bans'] || []).forEach(p => { const h = nm(p); if (!h) return; const x = H[h] || (H[h] = { p: 0, b: 0, w: 0 }); x.b++; });
    }));
    const G = Math.max(1, ms.length);
    return Object.entries(H).map(([h, x]) => ({ hero: h, picks: x.p, bans: x.b, pres: (x.p + x.b) / G, wr: x.p ? x.w / x.p : null, adjWR: shrink(x.w, x.p, 0.5, 6) }))
      .sort((a, b) => b.pres - a.pres);
  };

  // ── Compact text block for an LLM prompt ───────────────────────────────
  W.promptBlock = function (I, levers) {
    if (!I || !I.n) return `${I ? I.team : 'Team'}: no games in scope.`;
    const lines = [];
    lines.push(`${I.team}: ${I.wins}-${I.n - I.wins} (${pct(I.wr)}%) · strength rank ${I.rank}/${I.teams} · vs schedule ${I.overExp >= 0 ? '+' : ''}${pct(I.overExp)} pts · last5 ${I.last5.join('')}`);
    lines.push(`Side: Blue ${I.side.blue.w}-${I.side.blue.g - I.side.blue.w}, Red ${I.side.red.w}-${I.side.red.g - I.side.red.w}`);
    const lanes = W.LANES.filter(l => I.lanes[l]).map(l => { const L = I.lanes[l]; return `${l}${L.main ? '[' + L.main + ']' : ''}: ${L.top.map(x => `${x.hero} ${x.w}-${x.g - x.w}`).join(', ')}`; });
    if (lanes.length) lines.push('Pool by lane — ' + lanes.join(' | '));
    if (I.banImpact.length) lines.push('Ban impact (WR open → WR when banned) — ' + I.banImpact.slice(0, 5).map(b => `${b.hero} ${pct(b.availWR)}%→${pct(b.bannedWR)}% (${b.bannedG}g banned)`).join(', '));
    if (I.beatenBy.length) lines.push('Heroes opponents beat them with — ' + I.beatenBy.slice(0, 5).map(b => `${b.hero} ${b.oppW}-${b.g - b.oppW} (exp ${pct(b.expWR)}%)`).join(', '));
    const fp = Object.entries(I.firstPicks).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (fp.length) lines.push('First picks — ' + fp.map(([h, c]) => `${h} ${c}x`).join(', '));
    const t = [];
    if (I.dur.avgWin && I.dur.avgLoss) t.push(`avg win ${I.dur.avgWin.toFixed(1)}m / loss ${I.dur.avgLoss.toFixed(1)}m`);
    if (I.dur.short.g) t.push(`<14m ${I.dur.short.w}-${I.dur.short.g - I.dur.short.w}`);
    if (I.dur.long.g) t.push(`>18m ${I.dur.long.w}-${I.dur.long.g - I.dur.long.w}`);
    if (I.ft.g) t.push(`first turtle ${I.ft.got}/${I.ft.g}`);
    if (I.fb.g) t.push(`first blood ${I.fb.got}/${I.fb.g}`);
    if (I.turtle.all) t.push(`turtles ${I.turtle.ours}/${I.turtle.all}`);
    if (I.lord.all) t.push(`lords ${I.lord.ours}/${I.lord.all}`);
    if (t.length) lines.push('Tempo — ' + t.join(', '));
    if (levers && levers.length) lines.push('Data levers — ' + levers.map(l => `${l.text} [${l.conf}]: ${l.why}`).join(' || '));
    return lines.join('\n');
  };

  // ── Recent games for a team (newest first), compact text lines ─────────
  W.recentGames = function (matches, team, n) {
    return (matches || []).filter(m => sideOf(m, team) && (m.winner === 'blue' || m.winner === 'red'))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, n || 8).map(m => {
        const s = sideOf(m, team), o = other(s), opp = s === 'blue' ? m.redTeam : m.blueTeam, win = m.winner === s;
        const pk = (m[s + 'Picks'] || []).map(p => nm(p) + (p && p.lane ? '(' + p.lane + ')' : '')).join(', ');
        const op = (m[o + 'Picks'] || []).map(nm).join(', ');
        const d = W.mins(m.duration);
        const obj = m.objectives || {};
        const ft = Array.isArray(obj.turtle) && obj.turtle[0] ? (obj.turtle[0] === s ? 'got 1st turtle' : 'lost 1st turtle') : '';
        const where = [W.stageGroup(m) === 'Scrims' ? 'SCRIM' : (m.stage || W.stageGroup(m)), m.week, m.seriesFormat ? m.seriesFormat + (m.gameNum ? ' G' + m.gameNum : '') : ''].filter(Boolean).join(' · ');
        return `${(m.date || '').slice(0, 10)} ${win ? 'WIN' : 'LOSS'} vs ${opp} [${where}${where ? ' · ' : ''}${s}${d ? ', ' + Math.round(d) + 'm' : ''}${ft ? ', ' + ft : ''}] picks: ${pk} | vs: ${op} | their bans: ${(m[s + 'Bans'] || []).map(nm).join(', ')} | banned vs them: ${(m[o + 'Bans'] || []).map(nm).join(', ')}`;
      });
  };

  // ── Stages & series ───────────────────────────────────────────────────
  // Scout stores stage ('Regular Season', 'Playoffs', 'Grand Finals', …),
  // week ('Week 8 Day 1', 'Playoffs Day 2') and series (seriesId, BO3/BO5,
  // gameNum). Regular season and playoffs are different contexts — standings
  // are a regular-season series table, playoffs are knockout series.
  W.stageGroup = function (m) {
    const st = String((m && m.stage) || '').toLowerCase(), wk = String((m && m.week) || '').toLowerCase();
    if ((m && m.league) === 'Scrims' || /scrim/.test(st)) return 'Scrims';
    if (/play-?off|knock|bracket|elimin|final|semi|quarter|upper|lower/.test(st + ' ' + wk)) return 'Playoffs';
    if (/group|swiss/.test(st)) return 'Group Stage';
    if (!st || /regular|week|season/.test(st)) return 'Regular Season';
    return String(m.stage).trim();
  };
  W.seriesKey = m => m.seriesId || [m.league, m.season, m.stage, (m.week || m.date), [m.blueTeam, m.redTeam].sort().join('|'), m.seriesFormat || ''].join('|');
  // Series for one team (newest first): opponent, stage, format, score.
  W.series = function (matches, team) {
    const g = {};
    (matches || []).filter(m => sideOf(m, team) && (m.winner === 'blue' || m.winner === 'red')).forEach(m => {
      const k = W.seriesKey(m), s = sideOf(m, team);
      const x = g[k] || (g[k] = { opp: s === 'blue' ? m.redTeam : m.blueTeam, stage: W.stageGroup(m), stageRaw: m.stage || '', week: m.week || '', format: m.seriesFormat || '', date: m.date || '', w: 0, l: 0 });
      if (m.winner === s) x.w++; else x.l++;
      if ((m.date || '') > x.date) x.date = m.date;
    });
    return Object.values(g).map(x => ({ ...x, result: x.w > x.l ? 'W' : x.w < x.l ? 'L' : 'D' }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  };
  // Games and series record per stage for one team.
  W.stageSplit = function (matches, team) {
    const out = {};
    (matches || []).filter(m => sideOf(m, team) && (m.winner === 'blue' || m.winner === 'red')).forEach(m => {
      const st = W.stageGroup(m), x = out[st] || (out[st] = { gw: 0, gl: 0, sw: 0, sl: 0, sd: 0 });
      if (m.winner === sideOf(m, team)) x.gw++; else x.gl++;
    });
    W.series(matches, team).forEach(sr => { const x = out[sr.stage]; if (!x) return; if (sr.result === 'W') x.sw++; else if (sr.result === 'L') x.sl++; else x.sd++; });
    return out;
  };
  // Regular-season table: series wins, then game difference.
  W.standings = function (matches) {
    const reg = (matches || []).filter(m => W.stageGroup(m) === 'Regular Season' && (m.winner === 'blue' || m.winner === 'red'));
    const t = {};
    const add = n => t[n] || (t[n] = { team: n, sw: 0, sl: 0, sd: 0, gw: 0, gl: 0 });
    reg.forEach(m => { add(m.blueTeam); add(m.redTeam); const w = m.winner === 'blue' ? m.blueTeam : m.redTeam, l = m.winner === 'blue' ? m.redTeam : m.blueTeam; t[w].gw++; t[l].gl++; });
    const seen = new Set();
    Object.keys(t).forEach(n => W.series(reg, n).forEach(sr => {
      const k = [n, sr.opp, sr.date, sr.week].join('|'); if (seen.has(k)) return; seen.add(k);
      if (sr.result === 'W') t[n].sw++; else if (sr.result === 'L') t[n].sl++; else t[n].sd++;
    }));
    return Object.values(t).sort((a, b) => (b.sw - a.sw) || ((b.gw - b.gl) - (a.gw - a.gl)) || (a.sl - b.sl));
  };
  // All playoff series in a pool, oldest first: "date · stage (BO5): A 3-1 B".
  W.playoffSeries = function (matches) {
    const g = {};
    (matches || []).filter(m => W.stageGroup(m) === 'Playoffs' && (m.winner === 'blue' || m.winner === 'red')).forEach(m => {
      const k = W.seriesKey(m), a = [m.blueTeam, m.redTeam].sort()[0], b = a === m.blueTeam ? m.redTeam : m.blueTeam;
      const x = g[k] || (g[k] = { a, b, aw: 0, bw: 0, stage: m.stage || 'Playoffs', week: m.week || '', format: m.seriesFormat || '', date: m.date || '' });
      const winner = m.winner === 'blue' ? m.blueTeam : m.redTeam;
      if (winner === a) x.aw++; else x.bw++;
      if ((m.date || '') > x.date) x.date = m.date;
    });
    return Object.values(g).sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  };

  // ── One hero in this pool: presence, WR, who plays it, lanes ──────────
  W.hero = function (matches, hero) {
    const ms = (matches || []).filter(m => m && (m.winner === 'blue' || m.winner === 'red'));
    let p = 0, w = 0, b = 0; const teams = {}, lanes = {}, vs = {};
    ms.forEach(m => ['blue', 'red'].forEach(s => {
      const o = other(s), team = s === 'blue' ? m.blueTeam : m.redTeam;
      if ((m[s + 'Bans'] || []).some(x => nm(x) === hero)) b++;
      const pick = (m[s + 'Picks'] || []).find(x => nm(x) === hero);
      if (!pick) return;
      const win = m.winner === s; p++; if (win) w++;
      const T = teams[team] || (teams[team] = { g: 0, w: 0 }); T.g++; if (win) T.w++;
      if (pick.lane) lanes[pick.lane] = (lanes[pick.lane] || 0) + 1;
      (m[o + 'Picks'] || []).forEach(x => { const h = nm(x); const V = vs[h] || (vs[h] = { g: 0, w: 0 }); V.g++; if (win) V.w++; });
    }));
    const G = Math.max(1, ms.length);
    const vsList = Object.entries(vs).filter(([, v]) => v.g >= 3).map(([h, v]) => ({ hero: h, g: v.g, w: v.w, adj: shrink(v.w, v.g, p ? w / p : 0.5, 3) }));
    return {
      hero, games: ms.length, picks: p, wins: w, bans: b, pres: (p + b) / G, wr: p ? w / p : null,
      lanes: Object.entries(lanes).sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l} ${c}`),
      teams: Object.entries(teams).sort((a, b) => b[1].g - a[1].g).slice(0, 5).map(([t, v]) => `${t} ${v.w}-${v.g - v.w}`),
      bestInto: [...vsList].sort((a, b) => b.adj - a.adj).slice(0, 3).map(v => `${v.hero} ${v.w}-${v.g - v.w}`),
      worstInto: [...vsList].sort((a, b) => a.adj - b.adj).slice(0, 3).map(v => `${v.hero} ${v.w}-${v.g - v.w}`),
    };
  };

  // ── Find teams / heroes mentioned in free text ────────────────────────
  // "falcons", "srg", "rrq tora", "liquid ph" … Tie-breaks (e.g. "liquid" →
  // PH or ID) go to prefer(team) — usually the user's league, then recency.
  const norm = t => ' ' + String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const STOP = new Set(['team', 'esports', 'esport', 'gaming', 'gamers', 'club', 'the', 'legends', 'pro', 'ph', 'id', 'my', 'sg', 'th', 'kh', 'mena', 'of', 'and', 'vs', 'x', 'united', 'red', 'blue']);
  const REGION = new Set(['ph', 'id', 'my', 'sg', 'th', 'kh', 'mena']);
  W.findTeams = function (text, teams, prefer) {
    const q = norm(text), hits = [];
    (teams || []).forEach(t => {
      const full = norm(t), words = full.trim().split(' ');
      let score = 0; const matched = [];
      if (q.includes(full)) { score += 100; matched.push(full); }
      words.forEach(wd => { if (wd.length >= 3 && !STOP.has(wd) && q.includes(' ' + wd + ' ')) { score += 10; matched.push(wd); } });
      const core = words.filter(wd => !STOP.has(wd) || wd === 'red');
      const acr = words.filter(wd => wd !== 'team' && !REGION.has(wd)).map(wd => wd[0]).join('');
      if (acr.length >= 3 && q.includes(' ' + acr + ' ')) { score += 9; matched.push(acr); }
      const reg = words.find(wd => REGION.has(wd) && q.includes(' ' + wd + ' '));
      if (score && reg) { score += 5; matched.push(reg); }
      if (score) hits.push({ team: t, score: score + (prefer ? prefer(t) : 0), toks: matched.filter(x => x !== full) });
      void core;
    });
    hits.sort((a, b) => b.score - a.score);
    // Drop a hit whose matched words are all covered by a stronger hit
    // ("rrq tora" → RRQ Tora, not also RRQ Hoshi via "rrq").
    const out = [];
    hits.forEach(h => {
      if (h.score >= 100) { out.push(h); return; }
      if (out.some(o => h.toks.every(t => o.toks.includes(t)))) return;
      out.push(h);
    });
    return out.slice(0, 3).map(h => h.team);
  };
  W.findHeroes = function (text, heroNames) {
    const q = norm(text);
    return (heroNames || []).filter(h => { const n = norm(h); return n.trim().length >= 3 && q.includes(n); }).slice(0, 4);
  };

  root.WIntel = W;
})(typeof window !== 'undefined' ? window : globalThis);
