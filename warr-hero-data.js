// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — WHeroData: hero kits + patch notes (Liquipedia, refreshed every
// 6 h by the server) and "who is strong THIS patch".
//
//   WHeroData.load({full})      fetch /api/hero-data (cached 3 h in this browser)
//   WHeroData.hero(name)        { info, stats, traits, skills }
//   WHeroData.changes(name)     every buff / nerf / adjustment in the recent patches
//   WHeroData.currentPatch()    the patch in force today (and its release date)
//   WHeroData.patchPower(opts)  ranking: patch changes + pro picks / bans / wins on
//                               this patch + the draft model + solo-queue Top 100
//   WHeroData.augmentProfiles(WHeroProfile)  fill tags / missing heroes from the kits
//
// Raw numbers never decide strength alone: a buff is the earliest signal, then
// real games take over as they come in (each change's weight halves after ~25
// pro games on it). Content from Liquipedia, CC-BY-SA — credit with H.CREDIT.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const H = {};
  H.CREDIT = 'Hero and patch data: Liquipedia (CC-BY-SA)';
  const KEY = 'warr_herodata_v1', TTL = 3 * 3600e3;
  const norm = s => String((s && (s.name || s)) || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  H.norm = norm;
  let D = null, IDX = {}, FULL = false, pending = null;

  function index(d) {
    D = d && d.heroes ? d : { heroes: {}, patches: [], calendar: [] };
    IDX = {};
    Object.keys(D.heroes).forEach(t => { IDX[norm(t)] = t; });
    return D;
  }
  H.set = function (d, full) { FULL = !!full; return index(d); };
  H.ready = () => !!(D && Object.keys(D.heroes).length);
  H.data = () => D;

  H.load = function (opts) {
    opts = opts || {};
    if (D && (FULL || !opts.full) && H.ready()) return Promise.resolve(D);
    if (pending && !opts.full) return pending;
    let cached = null;
    if (!opts.full) {
      try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
      if (cached && cached.at && Date.now() - cached.at < TTL && cached.d && cached.d.heroes) return Promise.resolve(index(cached.d));
    }
    const url = '/api/hero-data' + (opts.full ? '?full=1' : '');
    pending = fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))).then(d => {
      if (d && d.heroes && Object.keys(d.heroes).length) {
        if (!opts.full) { try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), d })); } catch (_) {} }
        FULL = !!opts.full; return index(d);
      }
      return index((cached && cached.d) || d);
    }).catch(() => index((cached && cached.d) || D || null)).finally(() => { pending = null; });
    return pending;
  };

  const title = name => IDX[norm(name)] || null;
  H.title = title;
  H.siteName = function (t) {
    const ro = (root.WDB && root.WDB.HERO_ROSTER) || [];
    const hit = ro.find(r => norm(r.n) === norm(t));
    return hit ? hit.n : t;
  };
  H.hero = name => { const t = title(name); return t ? D.heroes[t] : null; };
  H.traits = name => { const h = H.hero(name); return h ? h.traits : null; };
  H.patches = () => (D && D.patches) || [];

  // ── Patch calendar ─────────────────────────────────────────────────────
  const majorOf = p => String(p || '').replace(/[a-zA-Z]+$/, '');
  H.majorOf = majorOf;
  H.calendar = () => ((D && D.calendar) || []).slice().sort((a, b) => a[1].localeCompare(b[1]));
  H.currentPatch = function (date) {
    date = date || new Date().toISOString().slice(0, 10);
    const cal = H.calendar().filter(c => c[1] <= date);
    if (!cal.length) return null;
    const cur = cal[cal.length - 1], major = majorOf(cur[0]);
    const firstOfMajor = cal.find(c => majorOf(c[0]) === major) || cur;
    const majors = [...new Set(cal.map(c => majorOf(c[0])))];
    const prevMajor = majors[majors.indexOf(major) - 1] || null;
    const prevFirst = prevMajor ? cal.find(c => majorOf(c[0]) === prevMajor) : null;
    return { name: cur[0], release: cur[1], major, since: firstOfMajor[1], prevMajor, prevSince: prevFirst ? prevFirst[1] : null };
  };

  // ── Changes for one hero ───────────────────────────────────────────────
  H.changes = function (name, opts) {
    opts = opts || {}; const t = title(name) || name, n = norm(t);
    const out = [];
    H.patches().forEach(p => (p.heroes || []).forEach(h => {
      if (norm(h.hero) !== n) return;
      if (opts.since && p.release && p.release < opts.since) return;
      out.push({ patch: p.name, release: p.release, type: h.type, score: h.score, note: h.note, slots: h.slots });
    }));
    return out;                                              // newest first
  };
  const fmtCh = c => `${c.label ? c.label + ' ' : ''}${c.from} → ${c.to}`.replace(/\s+/g, ' ').trim();
  H.changeLine = function (c, max) {
    const parts = (c.slots || []).map(s => {
      const ch = (s.changes || []).slice(0, 2).map(fmtCh).join('; ');
      const nmS = s.name || s.slot;
      return `${nmS}${s.type && s.type !== c.type ? ' (' + s.type + ')' : ''}${ch ? ': ' + ch : ''}`;
    }).filter(Boolean);
    let txt = `${c.patch} ${String(c.type || 'change').toUpperCase()}${c.release ? ' (' + c.release + ')' : ''} — ${parts.join(' · ') || c.note || 'changed'}`;
    if (max && txt.length > max) txt = txt.slice(0, max - 1) + '…';
    return txt;
  };

  // ── One-line kit summary ───────────────────────────────────────────────
  H.kitLine = function (name) {
    const h = H.hero(name); if (!h) return '';
    const t = h.traits || {}, i = h.info || {};
    const bits = [];
    if (t.hardCC && t.hardCC.length) bits.push(`CC: ${t.hardCC.join(', ')}${t.ccMax ? ' (up to ' + t.ccMax + 's)' : ''}`);
    else if (t.slow) bits.push('CC: slows only');
    if (t.dashes) bits.push(`${Math.min(t.dashes, 4)} mobility skill${t.dashes > 1 ? 's' : ''}`);
    ['invis:camouflage / invisible', 'invincible:untargetable / invincible window', 'ccImmune:CC immunity or cleanse', 'shield:shields', 'antiheal:anti-heal', 'trueDmg:true damage', 'pctHp:% HP damage (anti-tank)', 'execute:execute (missing HP)', 'global:global reach', 'shred:defense shred']
      .forEach(x => { const [k, lab] = x.split(':'); if (t[k]) bits.push(lab); });
    if (t.sustain >= 3) bits.push('high sustain'); else if (t.sustain >= 1.5) bits.push('some sustain');
    if (t.ultCd) bits.push(`ult CD ${t.ultCd[0]}${t.ultCd[1] !== t.ultCd[0] ? '→' + t.ultCd[1] : ''}s`);
    if (t.dmg) bits.push({ P: 'physical', M: 'magic', X: 'mixed/true' }[t.dmg] + ' damage');
    const role = [i.primaryrole, i.secondaryrole].filter(Boolean).join('/');
    return `${H.siteName(i.name || name)}${role || i.lane ? ` (${[i.lane, role].filter(Boolean).join(' ')})` : ''}: ${bits.join(' · ')}`;
  };
  H.skillsText = function (name, max) {
    const h = H.hero(name); if (!h) return '';
    return (h.skills || []).map(s => `${s.slot}${s.name ? ' ' + s.name : ''}${s.types && s.types.length ? ' [' + s.types.join(', ') + ']' : ''}${s.cd && s.cd.length ? ' CD ' + s.cd.join('/') + 's' : ''}${s.text ? ': ' + s.text.replace(/\s+/g, ' ').slice(0, max || 320) : ''}`).join('\n');
  };

  // ── Patch changes still "live": this patch at full weight, the one before at
  // 35 %; each change's weight halves after ~25 pro games have been played on it.
  H.kitDeltas = function (opts) {
    opts = opts || {};
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const cur = H.currentPatch(date), games = (opts.games || []).filter(m => m && m.date);
    const since = cur ? cur.since : null, prevSince = cur ? cur.prevSince : null;
    const kit = {};
    H.patches().forEach(p => {
      if (!p.release || p.release > date) return;
      const inCur = since && p.release >= since, inPrev = prevSince && p.release >= prevSince && !inCur;
      if (!inCur && !inPrev) return;
      const gSince = games.filter(m => m.date >= p.release && m.date <= date).length;
      const w = (inCur ? 1 : 0.35) / (1 + gSince / 25);
      (p.heroes || []).forEach(h => {
        const k = norm(h.hero); const x = kit[k] || (kit[k] = { name: H.siteName(h.hero), delta: 0, list: [], revamp: false });
        x.delta += w * (h.score || 0); if (h.type === 'revamp') x.revamp = true;
        x.list.push({ patch: p.name, release: p.release, type: h.type, score: h.score, slots: h.slots, note: h.note });
      });
    });
    return kit;
  };
  // For WBan: { 'Kalea': { delta, line } } by site hero name.
  H.kitBySite = function (opts) {
    const k = H.kitDeltas(opts), out = {};
    Object.values(k).forEach(x => { out[x.name] = { delta: x.delta, revamp: x.revamp, line: x.list[0] ? H.changeLine(x.list[0], 120) + ' (Liquipedia)' : '' }; });
    return out;
  };
  H.patchOfGame = function (m) {
    if (!m) return '';
    if (m.patch) return majorOf(m.patch);
    let p = ''; H.calendar().forEach(c => { if (c[1] <= (m.date || '')) p = c[0]; });
    return majorOf(p);
  };

  // ── Patch power ────────────────────────────────────────────────────────
  // opts: { games, top100, model, date, scope }  games = official matches
  H.patchPower = function (opts) {
    opts = opts || {};
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const cur = H.currentPatch(date);
    const games = (opts.games || []).filter(m => m && m.date);
    const pickOf = p => String((p && (p.name || p)) || '').trim();
    const since = cur ? cur.since : null, prevSince = cur ? cur.prevSince : null;
    // A game's patch: its own patch field when logged (leagues can run an older
    // tournament build), otherwise the patch in force on its date.
    const patchOfGame = H.patchOfGame;
    const G = cur ? games.filter(m => m.date <= date && patchOfGame(m) === cur.major) : [];
    const P = cur && cur.prevMajor ? games.filter(m => m.date <= date && patchOfGame(m) === cur.prevMajor) : [];
    const tally = list => {
      const o = {};
      list.forEach(m => ['blue', 'red'].forEach(s => {
        (m[s + 'Picks'] || []).forEach(p => { const k = norm(pickOf(p)); if (!k) return; const x = o[k] || (o[k] = { name: pickOf(p), picks: 0, bans: 0, wins: 0 }); x.picks++; if (m.winner === s) x.wins++; });
        (m[s + 'Bans'] || []).forEach(b => { const k = norm(pickOf(b)); if (!k) return; const x = o[k] || (o[k] = { name: pickOf(b), picks: 0, bans: 0, wins: 0 }); x.bans++; });
      }));
      return o;
    };
    const tg = tally(G), tp = tally(P);
    const nG = G.length, nP = P.length;
    const conf = nG / (nG + 30);
    // solo queue
    const t100 = opts.top100 && Array.isArray(opts.top100.heroes) ? opts.top100 : null;
    const soloOf = {}; let soloDamp = 1;
    if (t100) {
      const tot = t100.total_players || 100;
      t100.heroes.forEach(r => { const k = norm(r.hero || r.name); if (k) soloOf[k] = { users: r.top100_users || 0, share: (r.top100_users || 0) / tot, wr: r.avg_win_rate != null ? (r.avg_win_rate > 1 ? r.avg_win_rate / 100 : r.avg_win_rate) : null }; });
      if (since && t100.scraped_at && String(t100.scraped_at).slice(0, 10) < since) soloDamp = 0.5;   // snapshot is from the old patch
    }
    // patch changes since the previous major (this patch counts fully, the one before at 35 %)
    const kit = H.kitDeltas({ games, date });
    const names = new Set([...Object.keys(D ? D.heroes : {}).map(norm), ...Object.keys(tg), ...Object.keys(kit)]);
    const rows = [];
    names.forEach(k => {
      const t = IDX[k], info = t && D.heroes[t] ? D.heroes[t].info || {} : {};
      const g = tg[k] || { picks: 0, bans: 0, wins: 0 }, pp = tp[k] || { picks: 0, bans: 0, wins: 0 };
      const pres = nG ? (g.picks + g.bans) / nG : 0, presPrev = nP ? (pp.picks + pp.bans) / nP : 0;
      const wrS = (g.wins + 4) / (g.picks + 8);
      // presence + ban rate (the pros' verdict: OP heroes get banned, which hides their WR) + shrunk WR
      const banRate = nG ? g.bans / nG : 0, banPrev = nP ? pp.bans / nP : 0;
      const proPts = conf * (10 * pres + 4 * banRate + 14 * (wrS - 0.5) * Math.min(1, g.picks / 6)) + (1 - conf) * (6 * presPrev + 2 * banPrev);
      const mw = opts.model && opts.model.w ? opts.model.w['h:' + H.siteName(t || (tg[k] && tg[k].name) || k)] : null;
      const modelPts = mw != null ? Math.max(-2.5, Math.min(2.5, mw * 4)) : 0;
      const so = soloOf[k];
      const soloPts = so ? soloDamp * (2.5 * Math.min(1, so.share / 0.15) + (so.wr != null ? 5 * (so.wr - 0.5) * Math.min(1, so.share * 10) : 0)) : 0;
      const kx = kit[k];
      const kitPts = kx ? Math.max(-4, Math.min(4, 6 * kx.delta)) : 0;
      const score = proPts + modelPts + soloPts + kitPts;
      const name = H.siteName(t || (tg[k] && tg[k].name) || (kx && kx.name) || k);
      const reasons = [];
      if (kx && kx.list.length) kx.list.slice(0, 2).forEach(c => reasons.push(H.changeLine(c, 170)));
      if (nG) reasons.push(`pro on ${cur.major}: ${Math.round(pres * 100)}% presence (${g.picks}P ${g.bans}B in ${nG} games)${g.picks ? `, ${g.wins}-${g.picks - g.wins}` : ''}${nP ? ` · was ${Math.round(presPrev * 100)}% on ${cur.prevMajor}` : ''}`);
      else if (nP && presPrev) reasons.push(`no pro games on ${cur ? cur.major : 'this patch'} yet · ${Math.round(presPrev * 100)}% presence on ${cur && cur.prevMajor}`);
      if (so && so.users) reasons.push(`solo-queue Top 100: ${so.users} players${so.wr != null ? `, ${Math.round(so.wr * 100)}% WR` : ''}${soloDamp < 1 ? ' (snapshot before this patch)' : ''}`);
      if (mw != null && Math.abs(mw) > 0.08) reasons.push(`draft model: ${mw > 0 ? '+' : ''}${(mw * 25).toFixed(1)} win-% pts on its own`);
      const cmp = nG >= 10 && nP >= 10;                       // presence trend only when both patches have games
      const trend = (kx && kx.delta > 0.2) || (cmp && pres - presPrev > 0.12) ? 'rising' : (kx && kx.delta < -0.2) || (cmp && presPrev - pres > 0.12) ? 'falling' : '';
      const signal = nG && (g.picks + g.bans) || kx || (so && so.users) || (nP && pp.picks + pp.bans);
      rows.push({ hero: name, lane: info.lane || '', role: info.primaryrole || '', score: +score.toFixed(2), trend, revamp: !!(kx && kx.revamp),
        pro: { pres: +pres.toFixed(3), presPrev: +presPrev.toFixed(3), picks: g.picks, bans: g.bans, wins: g.wins },
        kit: kx ? { delta: +kx.delta.toFixed(3), changes: kx.list } : null, solo: so || null, model: mw, parts: { pro: +proPts.toFixed(2), model: +modelPts.toFixed(2), solo: +soloPts.toFixed(2), kit: +kitPts.toFixed(2) }, reasons, signal: !!signal });
    });
    rows.sort((a, b) => b.score - a.score);
    const ranked = rows.filter(r => r.signal), n = ranked.length;
    ranked.forEach((r, i) => { const q = i / Math.max(1, n); r.tier = q < 0.06 ? 'S' : q < 0.2 ? 'A' : q < 0.45 ? 'B' : q < 0.75 ? 'C' : 'D'; r.rank = i + 1; });
    rows.filter(r => !r.signal).forEach(r => { r.tier = '—'; });
    return { patch: cur, games: nG, prevGames: nP, confidence: +conf.toFixed(2), rows,
      note: !cur ? 'No patch calendar yet (hero data not loaded).' : nG < 15 ? `Only ${nG} pro games on ${cur.major} so far — the ranking leans on the patch changes and the previous patch until more games come in.` : `${nG} pro games on ${cur.major} — results drive the ranking; patch changes still count for heroes with few games since the change.` };
  };

  // ── Fill hero profiles from the kits (adds tags, never removes) ─────────
  H.augmentProfiles = function (HP) {
    if (!HP || !H.ready() || HP._kitAugmented === D.updated) return 0;
    let n = 0;
    Object.keys(D.heroes).forEach(t => {
      const h = D.heroes[t], tr = h.traits || {}, name = H.siteName(t);
      let p = HP.get && HP.get(name);
      if (!p && HP.addFromKit) { HP.addFromKit(name, h); p = HP.get(name); n++; }
      if (!p || !p.tags) return;
      const add = tag => { if (!p.tags.has(tag)) { p.tags.add(tag); n++; } };
      if (tr.invis) add('invis');
      if (tr.antiheal) add('antiheal');
      if ((tr.hardCC || []).includes('suppress')) add('lock');
      if (tr.trueDmg || tr.pctHp) add('shred');
      if (tr.sustain >= 3) add('sustain');
      if (tr.global) add('global');
    });
    HP._kitAugmented = D.updated;
    return n;
  };

  root.WHeroData = H;
})(typeof window !== 'undefined' ? window : globalThis);
