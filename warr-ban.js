// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — WBan: the ban engine (what a coach weighs before every ban)
//
//   WBan.plan(o) → { phase, theirSide, theirOpen, rows[], phase1[], phase2{}, strategy[], theirBans[], notes[] }
//
// A ban is worth what the opponent LOSES — not how good the hero is. So every
// candidate is valued as:
//
//   P(they pick it if open) × (its value to them − their next-best option in
//   that lane)                                    ← "replacement gap"
//   + meta denial (heroes pros ban on sight; OP heroes hide their win rate)
//   + their identity: first picks, last-pick counters, flex, duo halves,
//     tempo match, playoff / map / head-to-head / this-series history
//   + protection: heroes that beat YOU (official games + your own scrims),
//     counters to your core heroes and to what you've already picked
//   × economy: don't ban what you can first-pick, don't spend a ban on a hero
//     they'll ban themselves, never ban into a lane they've already filled
//
// Uses every logged field: picks with lanes + players + KDA, ban order,
// series / game number, patch, map, stage, duration, phase winners, your
// scrims, curated counters/synergies, tier lists, Top 100, the draft model.
// Every factor is in rough win-% points and every row lists its top reasons.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const B = {};
  const nm = p => String((p && (p.name || p)) || '').trim();
  const LANES = ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'];
  const pct = x => Math.round(x * 100);
  const sideOf = (m, t) => (m.blueTeam === t ? 'blue' : m.redTeam === t ? 'red' : null);
  const other = s => (s === 'blue' ? 'red' : 'blue');
  const ageW = (d, now, half) => { const t = Date.parse(d || ''); return isFinite(t) ? Math.pow(0.5, Math.max(0, (now - t) / 864e5) / half) : 0.5; };
  const won = (m, s) => m.winner === s;
  const EARLY = new Set(['dive', 'pickoff']), LATE = new Set(['scale']);

  function archOfHero(h, arch) {
    const out = [];
    if (!arch) return out;
    Object.keys(arch).forEach(k => { if ((arch[k].heroes || []).includes(h)) out.push(k); });
    return out;
  }

  B.plan = function (o) {
    const W = root.WIntel, WD = root.WDraft;
    const opp = o.opp, us = o.us || '';
    const now = o.now || Date.parse([...o.meta, ...o.oppGames].reduce((z, m) => ((m.date || '') > z ? m.date || '' : z), '')) || Date.now();
    const meta = o.meta || [], oppG = o.oppGames || [], usG = o.usGames || [], scr = o.scrims || [], cross = o.cross || [];
    const rel = o.relations || {}, arch = o.archetypes || null;
    const tierOf = o.tierOf || (() => ''), mustBan = o.mustBan || (() => false);
    const notes = [];

    // ── 1. META (league, recency-weighted; ban rate = the pros' verdict) ──
    const M = {}; let G = 0, G21 = 0;
    const mrow = h => M[h] || (M[h] = { p: 0, w: 0, b: 0, p21: 0, b21: 0, pP: 0, wP: 0, bP: 0, map: { p: 0, w: 0 } });
    const cut21 = now - 21 * 864e5;
    // a game's patch: logged patch, else the patch in force on its date (Liquipedia calendar)
    const pOf = m => m.patch || (o.patchOf ? o.patchOf(m) : '') || '';
    const patches = {}; meta.forEach(m => { const p = pOf(m); if (p) patches[p] = (patches[p] || '') > (m.date || '') ? patches[p] : (m.date || ''); });
    const curPatch = Object.keys(patches).sort((a, b) => (patches[b] || '').localeCompare(patches[a] || '') || b.localeCompare(a, undefined, { numeric: true }))[0] || '';
    let GP = 0, GM = 0;
    meta.forEach(m => {
      const w = ageW(m.date, now, 60); G += w;
      const r21 = (Date.parse(m.date || '') || 0) >= cut21; if (r21) G21++;
      const onP = curPatch && pOf(m) === curPatch; if (onP) GP++;
      const onMap = o.map && m.map === o.map; if (onMap) GM++;
      ['blue', 'red'].forEach(s => {
        (m[s + 'Picks'] || []).forEach(p => { const r = mrow(nm(p)); r.p += w; if (won(m, s)) r.w += w; if (r21) r.p21++; if (onP) { r.pP++; if (won(m, s)) r.wP++; } if (onMap) { r.map.p++; if (won(m, s)) r.map.w++; } });
        (m[s + 'Bans'] || []).forEach(b => { const r = mrow(nm(b)); r.b += w; if (r21) r.b21++; if (onP) r.bP++; });
      });
    });
    const X = {}; let GX = 0;
    cross.forEach(m => { GX++; ['blue', 'red'].forEach(s => { [...(m[s + 'Picks'] || []), ...(m[s + 'Bans'] || [])].forEach(p => { const h = nm(p); X[h] = (X[h] || 0) + 1; }); }); });
    const t100 = {};
    if (o.top100 && Array.isArray(o.top100.heroes)) o.top100.heroes.forEach(r => { const h = r.hero || r.name; if (h) t100[h] = (r.top100_users || 0) / (o.top100.total_players || 100); });
    const metaOf = h => {
      const r = M[h] || mrow(h);
      const banRate = r.b / (G || 1), pres = (r.p + r.b) / (G || 1), openPick = r.p / Math.max(1e-6, (G || 1) - r.b);
      const wr = (r.w + 3) / (r.p + 6);
      const pres21 = G21 >= 8 ? (r.p21 + r.b21) / G21 : null;
      const presP = GP >= 10 ? (r.pP + r.bP) / GP : null, wrP = r.pP >= 3 ? (r.wP + 2) / (r.pP + 4) : null;
      const presX = GX >= 10 ? (X[h] || 0) / GX : null;
      const mapWR = GM >= 6 && r.map.p >= 3 ? (r.map.w + 2) / (r.map.p + 4) : null;
      const tier = tierOf(h), must = mustBan(h);
      const hw = o.model && o.model.w ? (o.model.w['h:' + h] || 0) : 0;
      const parts = [];
      const add = (k, v, label) => { if (Math.abs(v) >= 0.05) parts.push({ k, v, label }); };
      add('banRate', banRate * 14, `banned in ${pct(banRate)}% of games`);
      add('wr', (wr - 0.5) * 100 * 0.45, `${pct(wr)}% WR when picked (${Math.round(r.p)}g)`);
      if (pres21 != null) add('trend', (pres21 - pres) * 12, `${pres21 > pres ? 'rising' : 'falling'}: ${pct(pres21)}% presence in the last 3 weeks`);
      if (presP != null) add('patch', (presP - pres) * 6 + (wrP != null ? (wrP - wr) * 40 : 0), `patch ${curPatch}: ${pct(presP)}% presence${wrP != null ? `, ${pct(wrP)}% WR` : ''}`);
      if (presX != null) add('cross', presX * 4, `${pct(presX)}% presence in other leagues`);
      if (t100[h]) add('soloq', t100[h] * 3, `used by ${pct(t100[h])}% of solo-queue Top 100`);
      if (tier === 'S' || tier === 'A') add('tier', tier === 'S' ? 4 : 2, `${tier}-tier on your list`);
      if (must) add('must', 4, 'flagged must-ban');
      if (hw) add('model', hw * 25, `draft model rates it ${hw > 0 ? 'strong' : 'weak'}`);
      if (mapWR != null) add('map', (mapWR - wr) * 50, `${pct(mapWR)}% WR on ${o.map}`);
      // patch notes (Liquipedia): fresh buffs are banned before the results show it
      const kt = o.kit && o.kit[h];
      if (kt) { if (kt.revamp) add('kit', 1.5, 'revamped this patch — untested, unpredictable'); else add('kit', Math.max(-5, Math.min(5, kt.delta * 8)), kt.line || (kt.delta > 0 ? 'buffed this patch' : 'nerfed this patch')); }
      const strength = parts.reduce((s, x) => s + x.v, 0);
      return { banRate, pres, openPick, wr, pres21, presP, presX, strength, parts, picks: r.p };
    };

    // ── 2. OPPONENT profile (recency-weighted toward current form) ──
    const IO = W.team(oppG, opp, o.R);
    const DO = W.draftOrder(oppG, opp);
    const T = {}, P = {}, PL = {}, D2 = {};
    let tW = 0, tWins = 0;
    const lastOpp = oppG.reduce((z, m) => ((m.date || '') > z ? m.date || '' : z), '');
    const cut30 = (Date.parse(lastOpp) || now) - 30 * 864e5;
    oppG.forEach(m => {
      const s = sideOf(m, opp); if (!s) return;
      const w = ageW(m.date, now, 45), win = won(m, s); tW += w; if (win) tWins += w;
      const recent = (Date.parse(m.date || '') || 0) >= cut30;
      const po = /play-?off|final|semi|quarter|bracket|knock/i.test((m.stage || '') + ' ' + (m.week || ''));
      const picks = m[s + 'Picks'] || [];
      picks.forEach((p, i) => {
        const h = nm(p); if (!h) return;
        const t = T[h] || (T[h] = { g: 0, w: 0, rawG: 0, rawW: 0, recent: 0, po: 0, poW: 0, lanes: {}, last: 0, r5: 0, players: {} });
        t.g += w; if (win) t.w += w; t.rawG++; if (win) t.rawW++; if (recent) t.recent++; if (po) { t.po++; if (win) t.poW++; }
        if (p.lane) t.lanes[p.lane] = (t.lanes[p.lane] || 0) + 1;
        if (s === 'red' && i === 4 && picks.length === 5) t.r5++;
        if (p.player) {
          t.players[p.player] = (t.players[p.player] || 0) + 1;
          const pl = PL[p.player] || (PL[p.player] = { g: 0, w: 0, heroes: {}, k: 0, d: 0, a: 0, kn: 0 });
          pl.g++; if (win) pl.w++; const ph = pl.heroes[h] || (pl.heroes[h] = { g: 0, w: 0, k: 0, d: 0, a: 0, kn: 0 }); ph.g++; if (win) ph.w++;
          if (p.kda) { ph.k += +p.kda.k || 0; ph.d += +p.kda.d || 0; ph.a += +p.kda.a || 0; ph.kn++; pl.k += +p.kda.k || 0; pl.d += +p.kda.d || 0; pl.a += +p.kda.a || 0; pl.kn++; }
        }
      });
      for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
        const a = nm(picks[i]), b = nm(picks[j]); if (!a || !b) continue;
        const k = a < b ? a + '|' + b : b + '|' + a; const d = D2[k] || (D2[k] = { g: 0, w: 0 }); d.g++; if (win) d.w++;
      }
      (m[other(s) + 'Bans'] || []).forEach(b => { const h = nm(b); P[h] = (P[h] || 0) + 1; });     // banned AGAINST them
    });
    const base = tW ? tWins / tW : 0.5;
    const tempo = (() => {
      const d = IO.dur || {}, sh = d.short || { g: 0, w: 0 }, lg = d.long || { g: 0, w: 0 };
      if (sh.g >= 3 && lg.g >= 3) { const a = sh.w / sh.g, b = lg.w / lg.g; if (a - b >= 0.15) return 'early'; if (b - a >= 0.15) return 'late'; }
      const ph = IO.phase || {}; if (ph.early && ph.early.g >= 4 && ph.late && ph.late.g >= 4) { const a = ph.early.w / ph.early.g, b = ph.late.w / ph.late.g; if (a - b >= 0.15) return 'early'; if (b - a >= 0.15) return 'late'; }
      return '';
    })();
    if (tempo) notes.push(`${opp} is ${tempo === 'early' ? 'an early-game team (they win fast and fade late)' : 'a late-game team (they win long games)'} — ${tempo === 'early' ? 'early dive/pickoff heroes' : 'scaling heroes'} are worth more to them.`);
    // their ban habits (what they'll spend bans on)
    const theirBanHabit = {}; let theirN = 0;
    oppG.forEach(m => { const s = sideOf(m, opp); if (!s) return; theirN++; (m[s + 'Bans'] || []).forEach(b => { const h = nm(b); theirBanHabit[h] = (theirBanHabit[h] || 0) + 1; }); });

    // ── 3. US: our comfort, what beats us (official + scrims) ──
    const IU = us && usG.length ? W.team(usG, us, o.R) : null;
    const ourSig = IU ? IU.signature.slice(0, 5).map(s => s.hero) : [];
    const scrimVs = {}; let scrG = 0, scrW = 0;
    scr.forEach(m => {
      const s = sideOf(m, us); if (!s) return; scrG++; const win = won(m, s); if (win) scrW++;
      (m[other(s) + 'Picks'] || []).forEach(p => { const h = nm(p); const x = scrimVs[h] || (scrimVs[h] = { g: 0, l: 0 }); x.g++; if (!win) x.l++; });
    });
    const scrBase = scrG ? scrW / scrG : 0.5;

    // ── 4. The draft so far ──
    const ourSide = o.side === 'blue' || o.side === 'red' ? o.side : '';
    const theirSide = ourSide ? other(ourSide) : 'red';
    const dr = o.draft || { bluePicks: [], redPicks: [], blueBans: [], redBans: [] };
    const theirPicks = (dr[theirSide + 'Picks'] || []).filter(p => nm(p)), ourPicks = (dr[(ourSide || 'blue') + 'Picks'] || []).filter(p => nm(p));
    const taken = new Set([...(dr.bluePicks || []), ...(dr.redPicks || []), ...(dr.blueBans || []), ...(dr.redBans || [])].map(nm));
    const theirOpen = LANES.filter(l => !theirPicks.some(p => p.lane === l));
    const nBans = (dr.blueBans || []).length + (dr.redBans || []).length;
    const phase = o.phase || (nBans >= 6 || theirPicks.length || ourPicks.length ? 2 : 1);
    let pBase = null;
    const model = o.model && o.model.w && Object.keys(o.model.w).length ? o.model : null;
    try { if (model && WD) pBase = WD.prob(model, { ...dr, blueTeam: theirSide === 'blue' ? opp : us, redTeam: theirSide === 'red' ? opp : us }, { noStrength: true }); } catch (_) { pBase = null; }
    const modelGain = (h, lane) => {
      if (pBase == null || !lane) return 0;
      const d2 = { ...dr, blueTeam: theirSide === 'blue' ? opp : us, redTeam: theirSide === 'red' ? opp : us, [theirSide + 'Picks']: [...theirPicks, { name: h, lane }] };
      const p = WD.prob(model, d2, { noStrength: true });
      return (theirSide === 'blue' ? p - pBase : pBase - p) * 100;
    };
    const lanesOf = h => (o.lanes && o.lanes[h]) || [];

    // their value of a hero (win-% points), and their lane for it
    const laneFor = h => {
      const t = T[h]; const ls = t ? Object.keys(t.lanes).sort((a, b) => t.lanes[b] - t.lanes[a]) : [];
      const all = [...ls, ...lanesOf(h)];
      return (theirPicks.length ? all.find(l => theirOpen.includes(l)) : all[0]) || '';
    };
    const valueThem = (h, mt) => {
      const t = T[h];
      const edge = t ? ((t.w + base * 4) / (t.g + 4) - base) * 100 : 0;
      return 0.45 * mt.strength + 0.55 * edge;
    };
    const metaCache = {}; const metaH = h => metaCache[h] || (metaCache[h] = metaOf(h));

    // ── 5. Score every candidate ──
    const cand = new Set([...Object.keys(T), ...Object.keys(M).filter(h => metaH(h).pres >= 0.1), ...(IU ? IU.beatenBy.slice(0, 10).map(b => b.hero) : []),
      ...Object.keys(scrimVs).filter(h => scrimVs[h].g >= 3)]);
    const rows = [];
    cand.forEach(h => {
      if (!h || taken.has(h)) return;
      const lane = laneFor(h);
      if (theirPicks.length && !lane) return;                               // they have no open lane for it → wasted ban
      const mt = metaH(h), t = T[h];
      const F = [];
      const CAP = { gap: 10, meta: 9, comfort: 6, impact: 7, flex: 4, priority: 6, r5: 5, player: 8, duo: 7, tempo: 2.5, stage: 4, h2h: 6, series: 6, protect: 6, scrims: 6, counter: 8 };
      const add = (k, v, label) => { if (!v) return; v = Math.max(-CAP[k] || -10, Math.min(CAP[k] || 10, v)); if (Math.abs(v) >= 0.15) F.push({ k, v, label }); };
      // P(they pick it if open)
      const openG = Math.max(1, IO.n - ((IO.bannedBy[h] && IO.bannedBy[h].g) || 0));
      let pPick = ((t ? t.rawG : 0) + 4 * mt.openPick) / (openG + 4);
      if (t && t.recent >= 2) pPick *= 1.2;
      pPick = Math.min(0.95, pPick);
      // value to them vs their next-best option in that lane (replacement gap)
      const vh = valueThem(h, mt) + modelGain(h, lane) * 0.5;
      let alt = null, altV = -3;                                           // no real alternative → forced off-comfort
      if (lane) {
        Object.keys(T).forEach(k => {
          if (k === h || taken.has(k) || !(T[k].lanes[lane] >= 2)) return;
          const v = valueThem(k, metaH(k)); if (v > altV) { altV = v; alt = k; }
        });
      }
      const gap = Math.max(0, vh - altV);
      add('gap', pPick * gap, alt ? `${pct(pPick)}% likely to be picked; worth ${gap.toFixed(1)} pts more to them than their next ${lane} option (${alt})` : `${pct(pPick)}% likely to be picked; they have no other proven ${lane || 'option'} — off-comfort if banned`);
      // meta denial: OP heroes are banned on sight (their WR is hidden by bans)
      const denial = mt.banRate * 10 + Math.max(0, mt.strength) * 0.25;
      add('meta', denial, mt.parts.sort((a, b) => b.v - a.v).slice(0, 2).map(x => x.label).join(', ') || `${pct(mt.pres)}% presence`);
      if (t) {
        const tg = t.rawG, tw = t.rawW;
        add('comfort', Math.min(6, tg / Math.max(1, IO.n) * 12) * (tw / Math.max(1, tg) >= base ? 1 : 0.5), `${opp} ${tw}-${tg - tw} on it (${pct(tg / Math.max(1, IO.n))}% of their games${t.recent ? `, ${t.recent} in the last 30 days` : ''})`);
      }
      const bi = IO.banImpact.find(b => b.hero === h);
      if (bi && bi.impact > 0.05) add('impact', bi.impact * 100 * Math.min(1, Math.max(0, bi.z) / 2) * Math.min(1, bi.bannedG / 8) * 0.5, `${opp} ${pct(bi.availWR)}% when it's open → ${pct(bi.bannedWR)}% when banned (${bi.bannedG}g, ${W.conf(bi.z)})`);
      const fl = t ? Object.keys(t.lanes).filter(l => t.lanes[l] >= 2).length : 0;
      if (fl >= 2) add('flex', (fl - 1) * 1.8, `flex for them (${Object.keys(t.lanes).filter(l => t.lanes[l] >= 2).join('/')}) — hides their lanes`);
      const firstN = ((DO.first.blue[h] && DO.first.blue[h].g) || 0) + ((DO.first.red[h] && DO.first.red[h].g) || 0);
      if (firstN >= 2 && !DO.laneOrdered) add('priority', Math.min(6, firstN / Math.max(3, DO.ordered * 0.25) * 6), `their first pick ${firstN}x`);
      if (ourSide === 'blue' && t && t.r5 >= 2) add('r5', Math.min(5, t.r5 * 1.5), `their last-pick counter (R5) ${t.r5}x`);
      // player level: the carry's comfort / a one-trick player
      if (t && Object.keys(t.players).length) {
        const pl = Object.keys(t.players).sort((a, b) => t.players[b] - t.players[a])[0], P2 = PL[pl];
        if (P2 && P2.g >= 4) {
          const ph = P2.heroes[h], share = ph.g / P2.g;
          const tops = Object.values(P2.heroes).map(x => x.g).sort((a, b) => b - a), top2 = (tops[0] + (tops[1] || 0)) / P2.g;
          const kdaH = ph.kn ? (ph.k + ph.a) / Math.max(1, ph.d) : null, kdaP = P2.kn ? (P2.k + P2.a) / Math.max(1, P2.d) : null;
          let v = 0; const bits = [];
          if (share >= 0.3) { v += share * 6; bits.push(`${pl} plays it in ${pct(share)}% of his games`); }
          if (top2 >= 0.7 && Object.keys(P2.heroes).length <= 3) { v += 2; bits.push(`${pl}'s pool is ${Object.keys(P2.heroes).length} heroes`); }
          if (kdaH != null && kdaP != null && ph.kn >= 2 && kdaH > kdaP * 1.25) { v += 1.5; bits.push(`KDA ${kdaH.toFixed(1)} on it vs ${kdaP.toFixed(1)} overall`); }
          if (v) add('player', v, bits.join(', '));
        }
      }
      // duo halves: deny the pair they rely on (stronger if one half is already locked)
      let duo = null;
      Object.keys(D2).forEach(k => {
        const [a, b] = k.split('|'); if (a !== h && b !== h) return;
        const d = D2[k], partner = a === h ? b : a; if (d.g < 3) return;
        const adj = (d.w + base * 3) / (d.g + 3) - base; if (adj < 0.05) return;
        const locked = theirPicks.some(p => nm(p) === partner);
        const v = adj * 100 * (locked ? 0.35 : 0.12);
        if (!duo || v > duo.v) duo = { v, partner, d, locked };
      });
      if (duo) add('duo', duo.v, `${duo.locked ? 'completes' : 'pairs with'} ${duo.partner} (${duo.d.w}-${duo.d.g - duo.d.w} together)${duo.locked ? ' — they already locked ' + duo.partner : ''}`);
      // tempo: early teams live on early heroes, late teams on scaling
      if (tempo) {
        const ar = archOfHero(h, arch);
        if ((tempo === 'early' && ar.some(a => EARLY.has(a))) || (tempo === 'late' && ar.some(a => LATE.has(a)))) add('tempo', 2.5, `fits their ${tempo}-game style`);
      }
      if (o.stage === 'Playoffs' && t && t.po >= 2) add('stage', Math.min(4, t.po * 1.2), `played ${t.po}x in playoffs (${t.poW}-${t.po - t.poW})`);
      // head-to-head and this series
      if (us) {
        let hg = 0, hw = 0;
        oppG.forEach(m => { const s = sideOf(m, opp); if (!s || !(m.blueTeam === us || m.redTeam === us)) return; if ((m[s + 'Picks'] || []).some(p => nm(p) === h)) { hg++; if (won(m, s)) hw++; } });
        if (hg) add('h2h', Math.min(6, hw * 1.5 + (hg - hw) * 0.3), `they picked it vs ${us} ${hg}x (won ${hw})`);
      }
      (o.series || []).forEach((g, i) => {
        if ((g.theirPicks || []).includes(h)) add('series', g.weWon ? 2.5 : 6, `${g.weWon ? 'they played' : 'they beat you with'} it in game ${i + 1} of this series`);
      });
      // protection: what beats US
      if (IU) {
        const bb = IU.beatenBy.find(b => b.hero === h && b.g >= 3 && b.z > 0.3);
        if (bb) add('protect', Math.min(2, bb.z) * 3, `opponents went ${bb.oppW}-${bb.g - bb.oppW} with it vs ${us}`);
      }
      const sv = scrimVs[h];
      if (sv && sv.g >= 3) { const lr = (sv.l + (1 - scrBase) * 3) / (sv.g + 3) - (1 - scrBase); if (lr > 0.05) add('scrims', lr * 100 * 0.25, `beats ${us || 'you'} in your scrims (${sv.g - sv.l}-${sv.l} when they had it)`); }
      const core = [...new Set([...ourPicks.map(nm), ...ourSig])];
      let cc = 0; const ccBits = [];
      core.forEach(s => {
        if (rel[s] && (rel[s].counter || []).includes(h)) { cc += 2.5; ccBits.push(`counters your ${s}`); }
        if (model) {
          const k = h < s ? `lv:${h}>${s}` : `lv:${s}>${h}`, wv = model.w[k];
          if (wv) { const v = (h < s ? wv : -wv) * 30; if (v > 0.8) { cc += v; ccBits.push(`beats ${s} in lane (model)`); } }
        }
      });
      if (cc) add('counter', Math.min(8, cc * (ourPicks.length ? 1.3 : 1)), [...new Set(ccBits)].slice(0, 2).join(', '));
      // economy
      let mult = 1; const flags = {};
      if (IU && IU.heroes[h] && IU.heroes[h].g >= 3 && IU.heroes[h].w / IU.heroes[h].g >= IU.wr) {
        flags.contested = `${IU.heroes[h].w}-${IU.heroes[h].g - IU.heroes[h].w}`;
        const pTheyBan = theirN ? (theirBanHabit[h] || 0) / theirN : 0;
        if (pTheyBan >= 0.25) { mult *= 1 - 0.5 * pTheyBan; flags.theyBan = pct(pTheyBan); }
        if (phase === 1 && ourSide === 'blue' && mt.strength >= 4) { mult *= 0.7; flags.pickInstead = true; }
      }
      const raw = F.reduce((s, f) => s + f.v, 0);
      const score = raw * mult;
      F.sort((a, b) => b.v - a.v);
      const kind = { gap: 'COMFORT', comfort: 'COMFORT', impact: 'COMFORT', meta: 'META', priority: 'PRIORITY', r5: 'PRIORITY', player: 'PLAYER', duo: 'DUO', protect: 'PROTECT', scrims: 'PROTECT', counter: 'PROTECT', series: 'SERIES', h2h: 'H2H', flex: 'FLEX', tempo: 'STYLE', stage: 'PLAYOFFS' }[F[0] && F[0].k] || 'META';
      const evidence = (t ? t.rawG : 0) + Math.min(10, mt.picks / 3) + (bi ? bi.bannedG : 0);
      rows.push({ hero: h, lane, score, raw, mult, kind, factors: F, flags, pPick, alt, conf: evidence >= 12 ? 'strong' : evidence >= 5 ? 'solid' : 'early signal', meta: mt });
    });
    rows.sort((a, b) => b.score - a.score);

    // ── 6. Plan: phase 1 (3 bans), lane-lock, diversity; phase 2 by lane ──
    const strategy = [];
    LANES.forEach(l => {
      const L = IO.lanes[l]; if (!L || L.g < 5 || !L.top || L.top.length < 2) return;
      const two = L.top.slice(0, 2).filter(x => !taken.has(x.hero));
      if (two.length === 2 && L.share2 >= 0.72) strategy.push({ kind: 'lane-lock', lane: l, heroes: two.map(x => x.hero), share: L.share2, main: L.main });
    });
    const picked = [];
    const pool = rows.slice();
    const lock = strategy[0];
    while (picked.length < (phase === 1 ? 3 : 2) && pool.length) {
      pool.forEach(r => {
        r.adj = r.score;
        if (picked.some(p => p.lane && p.lane === r.lane) && !(lock && lock.lane === r.lane)) r.adj *= 0.85;   // spread bans unless locking a lane
        if (lock && lock.heroes.includes(r.hero) && picked.some(p => lock.heroes.includes(p.hero))) r.adj *= 1.25;  // finish the lock
      });
      pool.sort((a, b) => b.adj - a.adj);
      picked.push(pool.shift());
    }
    const phase2 = {};
    rows.slice(0, 25).forEach(r => { if (r.lane && (!theirPicks.length || theirOpen.includes(r.lane))) (phase2[r.lane] = phase2[r.lane] || []).length < 3 && phase2[r.lane].push(r.hero); });
    const theirBans = Object.entries(theirBanHabit).filter(([h]) => !taken.has(h)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, c]) => ({ hero: h, n: c, of: theirN }));
    return { phase, theirSide, ourSide, theirOpen, rows, picked, phase2, strategy, theirBans, notes, opp, us, n: { league: meta.length, opp: IO.n, us: IU ? IU.n : 0, scrims: scrG }, curPatch };
  };

  B.v2 = true;                 // v2: patch calendar + patch-note (kit) factor
  root.WBan = B;
})(typeof window !== 'undefined' ? window : globalThis);
