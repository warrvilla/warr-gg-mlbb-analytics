// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — WDraft: a draft model trained in the browser on logged games
//
//   WDraft.train(matches, opts)      → model   (≈0.1–0.5 s for a few thousand games)
//   WDraft.score(model, draft)       → { p, parts[], thin[] }   win chance for BLUE + why
//   WDraft.suggest(model, draft, side, opts) → best heroes for the next pick, by lane
//   WDraft.policy(matches, team)     → how a team actually drafts (slot habits)
//   WDraft.predict(policy, draft, team, side, kind, opts) → what that team will likely do next
//
// The model is a regularised logistic regression over:
//   • team strength (Bradley–Terry rating difference) + side — so the draft
//     terms measure what the DRAFT adds beyond "the better team wins"
//   • each hero, lane-vs-lane matchups, same-team duos
//   • comp identity (dive / poke / teamfight / pickoff / scale) and how
//     identities fare into each other, plus role balance (frontline, magic…)
// Recent games weigh more (half-life), sparse terms are shrunk hard, and the
// model is back-tested on the newest games before it is trusted.
// Draft = { blueTeam, redTeam, bluePicks:[{name,lane}], redPicks, blueBans, redBans }
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const D = {};
  const nm = p => String((p && (p.name || p)) || '').trim();
  const sig = x => 1 / (1 + Math.exp(-x));
  const LANES = ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'];
  const ARCH = ['dive', 'poke', 'teamfight', 'pickoff', 'scale'];
  // L2 strength per feature group (bigger = trust the data less). The overall
  // scale is tuned on a validation split at train time.
  const LAMBDA = { side: 0.3, str: 0.02, h: 1, lv: 3, d: 4, c: 1, cx: 2, r: 1 };
  const SCALES = [4, 12, 36, 108];
  const GROUP = k => k.slice(0, k.indexOf(':'));

  function roleMap(opts) {
    const out = {};
    const roster = (opts && opts.roster) || (root.WDB && root.WDB.HERO_ROSTER) || [];
    roster.forEach(h => { if (h && h.n) out[h.n] = h.r || ''; });
    return out;
  }
  function archOf(opts) { return (opts && opts.archetypes) || (root.WDB && root.WDB.COMP_ARCHETYPES) || null; }

  // Comp identity scores 0..1 for one side (same idea as WDB.detectComposition).
  function compScores(picks, roles, arch) {
    const s = {}; if (!arch || !picks.length) return s;
    ARCH.forEach(k => {
      const def = arch[k]; if (!def) return;
      let v = 0;
      picks.forEach(p => { const n = nm(p); if (def.heroes.includes(n)) v += 2; const r = (roles[n] || '').split('/')[0]; if (r && def.roles && def.roles[r]) v += def.roles[r] / 3; });
      s[k] = v / Math.max(picks.length * 2, 4);
    });
    return s;
  }
  function roleCounts(picks, roles) {
    const c = { tank: 0, fighter: 0, assassin: 0, mage: 0, mm: 0, support: 0 };
    picks.forEach(p => {
      const r = String(roles[nm(p)] || '').toLowerCase();
      if (/tank/.test(r)) c.tank += r.startsWith('tank') ? 1 : 0.5;
      if (/fighter/.test(r)) c.fighter += r.startsWith('fighter') ? 1 : 0.5;
      if (/assassin/.test(r)) c.assassin += r.startsWith('assassin') ? 1 : 0.5;
      if (/mage/.test(r)) c.mage += r.startsWith('mage') ? 1 : 0.5;
      if (/mm/.test(r)) c.mm += r.startsWith('mm') ? 1 : 0.5;
      if (/support/.test(r)) c.support += r.startsWith('support') ? 1 : 0.5;
    });
    return c;
  }

  // Sparse features for a (possibly partial) draft, from BLUE's point of view.
  // Everything except `side` is antisymmetric: swapping the teams flips the sign.
  function features(dr, ctx) {
    const f = {};
    const add = (k, v) => { if (v) f[k] = (f[k] || 0) + v; };
    const bp = (dr.bluePicks || []).filter(p => nm(p)), rp = (dr.redPicks || []).filter(p => nm(p));
    add('side:blue', 1);
    if (ctx.R && dr.blueTeam && dr.redTeam && ctx.R.r[dr.blueTeam] != null && ctx.R.r[dr.redTeam] != null) add('str:rating', ctx.R.r[dr.blueTeam] - ctx.R.r[dr.redTeam]);
    bp.forEach(p => add('h:' + nm(p), 1));
    rp.forEach(p => add('h:' + nm(p), -1));
    // lane-vs-lane matchups
    LANES.forEach(l => {
      const a = bp.find(p => p.lane === l), b = rp.find(p => p.lane === l);
      if (!a || !b) return;
      const x = nm(a), y = nm(b); if (x === y) return;
      if (x < y) add(`lv:${x}>${y}`, 1); else add(`lv:${y}>${x}`, -1);
    });
    // duos
    const duo = (ps, sgn) => { for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const a = nm(ps[i]), b = nm(ps[j]); add(`d:${a < b ? a + '+' + b : b + '+' + a}`, sgn); } };
    duo(bp, 1); duo(rp, -1);
    // comp identity + identity-vs-identity + role balance
    if (bp.length >= 3 && rp.length >= 3) {
      const cb = compScores(bp, ctx.roles, ctx.arch), cr = compScores(rp, ctx.roles, ctx.arch);
      ARCH.forEach(k => add('c:' + k, (cb[k] || 0) - (cr[k] || 0)));
      ARCH.forEach(a => ARCH.forEach(b => { if (a < b) add(`cx:${a}>${b}`, (cb[a] || 0) * (cr[b] || 0) - (cr[a] || 0) * (cb[b] || 0)); }));
      const rb = roleCounts(bp, ctx.roles), rr = roleCounts(rp, ctx.roles);
      add('r:frontline', Math.min(2, rb.tank + rb.fighter * 0.5) - Math.min(2, rr.tank + rr.fighter * 0.5));
      add('r:noTank', (rr.tank < 0.5 ? 1 : 0) - (rb.tank < 0.5 ? 1 : 0));     // + = only RED has no tank
      add('r:magicMix', (rb.mage > 0 && (rb.mm + rb.fighter + rb.assassin) > 0 ? 1 : 0) - (rr.mage > 0 && (rr.mm + rr.fighter + rr.assassin) > 0 ? 1 : 0));
      add('r:assassins', Math.min(2, rb.assassin) - Math.min(2, rr.assassin));
    }
    return f;
  }

  const ageDays = (d, now) => { const t = Date.parse(d || ''); return isFinite(t) ? Math.max(0, (now - t) / 864e5) : 365; };
  const usable = m => m && m.blueTeam && m.redTeam && (m.winner === 'blue' || m.winner === 'red') && (m.bluePicks || []).length >= 3 && (m.redPicks || []).length >= 3;

  // Rows → compact typed arrays over a shared feature index.
  function compile(rows, index) {
    return rows.map(r => {
      const ks = Object.keys(r.x).filter(k => index.has(k));
      const id = new Int32Array(ks.length), v = new Float64Array(ks.length);
      ks.forEach((k, j) => { id[j] = index.get(k); v[j] = r.x[k]; });
      return { id, v, y: r.y, wt: r.wt };
    });
  }
  // Logistic regression, full-batch Adam with per-group L2 (scaled).
  function fit(rows, keys, scale, iters) {
    const n = keys.length, index = new Map(keys.map((k, i) => [k, i]));
    const C = compile(rows, index);
    const lam = new Float64Array(n); keys.forEach((k, i) => { const g = GROUP(k); lam[i] = (LAMBDA[g] || 1) * (g === 'side' || g === 'str' ? 1 : scale); });
    const w = new Float64Array(n), m1 = new Float64Array(n), m2 = new Float64Array(n), g = new Float64Array(n);
    const W = C.reduce((s2, r) => s2 + r.wt, 0) || 1;
    const lr = 0.05, b1 = 0.9, b2 = 0.999;
    for (let it = 1; it <= iters; it++) {
      g.fill(0);
      for (const r of C) {
        let z = 0; for (let j = 0; j < r.id.length; j++) z += w[r.id[j]] * r.v[j];
        const e = (sig(z) - r.y) * r.wt;
        for (let j = 0; j < r.id.length; j++) g[r.id[j]] += e * r.v[j];
      }
      const c1 = 1 - Math.pow(b1, it), c2 = 1 - Math.pow(b2, it);
      for (let i = 0; i < n; i++) {
        const gk = (g[i] + lam[i] * w[i]) / W;
        m1[i] = b1 * m1[i] + (1 - b1) * gk; m2[i] = b2 * m2[i] + (1 - b2) * gk * gk;
        w[i] -= lr * (m1[i] / c1) / (Math.sqrt(m2[i] / c2) + 1e-8);
      }
    }
    const out = Object.create(null); keys.forEach((k, i) => { out[k] = w[i]; });
    return out;
  }
  const keysOf = (rows, filter) => { const s2 = new Set(); rows.forEach(r => Object.keys(r.x).forEach(k => { if (!filter || filter(k)) s2.add(k); })); return [...s2]; };
  const BASE = k => k.startsWith('side:') || k.startsWith('str:');
  const predictW = (w, x) => { let z = 0; for (const k in x) if (w[k] != null) z += w[k] * x[k]; return sig(z); };
  function evalSet(w, rows) {
    if (!rows.length) return null;
    let ll = 0, acc = 0, W = 0;
    rows.forEach(r => { const p = Math.min(1 - 1e-6, Math.max(1e-6, predictW(w, r.x))); ll += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); if ((p >= 0.5) === (r.y === 1)) acc++; W++; });
    return { n: rows.length, logloss: ll / W, acc: acc / W };
  }
  // Pick the regularisation scale on a time-ordered validation split.
  function tune(rows, iters, scales) {
    const cut = Math.floor(rows.length * 0.8), tr = rows.slice(0, cut), va = rows.slice(cut);
    const keys = keysOf(tr);
    let best = { scale: SCALES[SCALES.length - 1], ll: Infinity };
    (scales || SCALES).forEach(sc => { const e = evalSet(fit(tr, keys, sc, iters), va); if (e && e.logloss < best.ll) best = { scale: sc, ll: e.logloss }; });
    const base = evalSet(fit(tr, keysOf(tr, BASE), 1, iters), va);
    return { scale: best.scale, val: best.ll, valBase: base ? base.logloss : null };
  }

  D.train = function (matches, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const W = root.WIntel;
    const games = (matches || []).filter(usable).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const now = opts.now || Date.parse((games[games.length - 1] || {}).date || '') || Date.now();
    const half = opts.halfLifeDays || 180;
    const roles = roleMap(opts), arch = archOf(opts);
    const mk = (gs, R) => gs.map(m => ({ x: features(m, { R, roles, arch }), y: m.winner === 'blue' ? 1 : 0, wt: Math.pow(0.5, ageDays(m.date, now) / half) }));
    const model = { version: 1, trainedAt: new Date().toISOString(), n: games.length, w: {}, counts: {}, R: null, roles, arch, meta: {} };
    if (games.length < 20) { model.meta.note = 'Too few games to train (need 20+ with picks).'; return model; }
    const iters = opts.iters || 160;
    // ── Back-test: tune + train on the older 80%, test on the newest 20% ──
    const cut = Math.max(10, Math.floor(games.length * 0.8));
    const trainG = games.slice(0, cut), testG = games.slice(cut);
    if (testG.length >= 15 && W) {
      const Rt = W.ratings(trainG);
      const tr = mk(trainG, Rt), te = mk(testG, Rt);
      const tn = tune(tr, iters, opts.scales);
      const wFull = fit(tr, keysOf(tr), tn.scale, iters);
      const wBase = fit(tr, keysOf(tr, BASE), 1, iters);
      model.meta.backtest = { train: tr.length, test: te.length, scale: tn.scale, valDraft: tn.val, valBase: tn.valBase, draft: evalSet(wFull, te), base: evalSet(wBase, te),
        coin: { logloss: Math.log(2), acc: Math.max(te.filter(r => r.y === 1).length, te.filter(r => r.y === 0).length) / te.length } };
    }
    // ── Production model on everything (scale re-tuned on all data) ──
    const R = W ? W.ratings(games) : null;
    const rows = mk(games, R);
    const tn = model.meta.backtest ? { scale: model.meta.backtest.scale } : tune(rows, iters, opts.scales);
    model.meta.scale = tn.scale;
    model.w = fit(rows, keysOf(rows), tn.scale, iters);
    model.R = R ? { r: R.r } : null;
    rows.forEach(r => Object.keys(r.x).forEach(k => { model.counts[k] = (model.counts[k] || 0) + 1; }));
    model.meta.ms = Date.now() - t0;
    model.meta.dates = [(games[0] || {}).date || '', (games[games.length - 1] || {}).date || ''];
    return model;
  };

  // Human label for a feature. x = feature value (sign tells whose it is),
  // c = contribution to BLUE's logit (sign tells who it helps).
  function label(k, x, c) {
    const g = GROUP(k), body = k.slice(k.indexOf(':') + 1);
    const owner = x > 0 ? 'blue' : 'red', helps = c > 0 ? 'blue' : 'red', good = owner === helps;
    if (g === 'side') return 'blue side';
    if (g === 'str') return 'team strength';
    if (g === 'h') return good ? body : `${body} (weak pick for ${owner})`;
    if (g === 'lv') { const [a, b] = body.split('>'); const bl = x > 0 ? a : b, rd = x > 0 ? b : a; return helps === 'blue' ? `${bl} beats ${rd} in lane` : `${rd} beats ${bl} in lane`; }
    if (g === 'd') return `${body.replace('+', ' + ')} duo${good ? '' : ` (weak for ${owner})`}`;
    if (g === 'c') return `${owner}'s ${body} identity${good ? '' : ' (a minus here)'}`;
    if (g === 'cx') { const [a, b] = body.split('>'); return `${a} vs ${b} comp matchup`; }
    if (g === 'r') {
      if (body === 'noTank') return `${x > 0 ? 'red' : 'blue'} has no tank`;
      const nmR = ({ frontline: 'frontline', magicMix: 'magic + physical damage mix', assassins: 'assassin count' })[body] || body;
      return `${owner}'s ${nmR}${good ? '' : ' (a minus here)'}`;
    }
    return k;
  }

  D.score = function (model, dr) {
    const ctx = { R: model.R, roles: model.roles, arch: model.arch };
    const x = features(dr, ctx);
    let z = 0; const parts = [];
    Object.keys(x).forEach(k => {
      const w = model.w[k]; if (w == null) return;
      const c = w * x[k]; z += c;
      if (Math.abs(c) < 1e-4) return;
      const g = GROUP(k);
      parts.push({ key: k, group: g, label: label(k, x[k], c), logit: c, side: c > 0 ? 'blue' : 'red', owner: x[k] > 0 ? 'blue' : 'red', n: model.counts[k] || 0 });
    });
    const p = sig(z);
    parts.forEach(pt => { pt.pts = pt.logit * p * (1 - p) * 100; });   // ≈ win-% points
    parts.sort((a, b) => Math.abs(b.logit) - Math.abs(a.logit));
    return { p, z, parts, thin: parts.filter(pt => pt.n < 3 && pt.group !== 'side' && pt.group !== 'str').map(pt => pt.label) };
  };

  // Best heroes for `side`'s next pick: model gain vs the current draft.
  D.suggest = function (model, dr, side, opts) {
    opts = opts || {};
    const taken = new Set([...(dr.bluePicks || []), ...(dr.redPicks || []), ...(dr.blueBans || []), ...(dr.redBans || [])].map(nm));
    const mine = (dr[side + 'Picks'] || []).filter(p => nm(p));
    const open = LANES.filter(l => !mine.some(p => p.lane === l));
    const pool = opts.pool || {};      // { hero: [lanes] } — who can play where (from data)
    const base = D.score(model, dr).p;
    const out = [];
    Object.keys(pool).forEach(h => {
      if (taken.has(h)) return;
      (pool[h] || []).filter(l => open.includes(l)).forEach(l => {
        const nd = { ...dr, [side + 'Picks']: [...mine, { name: h, lane: l }] };
        const s = D.score(model, nd);
        const pSide = side === 'blue' ? s.p : 1 - s.p, bSide = side === 'blue' ? base : 1 - base;
        out.push({ hero: h, lane: l, p: pSide, gain: pSide - bSide, n: model.counts['h:' + h] || 0,
          why: s.parts.filter(pt => pt.key.includes(h) && pt.group !== 'h').slice(0, 2).map(pt => `${pt.label} ${(pt.pts >= 0) === (side === 'blue') ? '+' : '−'}${Math.abs(pt.pts).toFixed(1)}`) });
      });
    });
    out.sort((a, b) => b.gain - a.gain);
    const best = {}; out.forEach(o => { if (!best[o.hero] || best[o.hero].gain < o.gain) best[o.hero] = o; });
    return Object.values(best).sort((a, b) => b.gain - a.gain).slice(0, opts.limit || 8);
  };

  // ── How one team actually drafts: per-slot habits (imitation) ──────────
  // Slots: blue picks B1..B5 = index 0..4; red R1..R5. Bans: index 0..4 (0-2 phase 1).
  D.policy = function (matches, team) {
    const P = { team, n: 0, pick: { blue: [{}, {}, {}, {}, {}], red: [{}, {}, {}, {}, {}] }, ban: { blue: [{}, {}, {}, {}, {}], red: [{}, {}, {}, {}, {}] },
      hero: {}, banAny: {}, laneOrder: { blue: [{}, {}, {}, {}, {}], red: [{}, {}, {}, {}, {}] }, heroLane: {} };
    const inc = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
    (matches || []).forEach(m => {
      const s = m.blueTeam === team ? 'blue' : m.redTeam === team ? 'red' : null; if (!s) return;
      P.n++;
      (m[s + 'Bans'] || []).forEach((b, i) => { if (i < 5) inc(P.ban[s][i], nm(b)); inc(P.banAny, nm(b)); });
      const picks = m[s + 'Picks'] || [];
      const laneOrdered = picks.length === 5 && picks.map(p => p && p.lane).join(',') === LANES.join(',');
      picks.forEach((p, i) => {
        const h = nm(p); inc(P.hero, h);
        if (p && p.lane) { const L = P.heroLane[h] || (P.heroLane[h] = {}); inc(L, p.lane); }
        if (!laneOrdered && i < 5) { inc(P.pick[s][i], h); if (p && p.lane) inc(P.laneOrder[s][i], p.lane); }
      });
    });
    return P;
  };
  const SLOT_NAME = (side, kind, i) => kind === 'ban' ? `${side} ban ${i + 1}${i < 3 ? ' (phase 1)' : ' (phase 2)'}` : `${side === 'blue' ? 'B' : 'R'}${i + 1}`;

  // What will `team` do at its next pick/ban? Ranked candidates with reasons.
  D.predict = function (P, dr, team, side, kind, opts) {
    opts = opts || {};
    const taken = new Set([...(dr.bluePicks || []), ...(dr.redPicks || []), ...(dr.blueBans || []), ...(dr.redBans || [])].map(nm));
    const i = (kind === 'ban' ? (dr[side + 'Bans'] || []) : (dr[side + 'Picks'] || [])).length;
    const mine = (dr[side + 'Picks'] || []);
    const openLanes = LANES.filter(l => !mine.some(p => p && p.lane === l));
    const slot = kind === 'ban' ? P.ban[side][i] || {} : P.pick[side][i] || {};
    const slotN = Object.values(slot).reduce((a, b) => a + b, 0);
    const meta = opts.meta || {};          // { hero: presence 0..1 } league context
    const pool = kind === 'ban' ? P.banAny : P.hero;
    const poolN = Object.values(pool).reduce((x, y) => x + y, 0) || 1;
    const lo = kind === 'pick' ? (P.laneOrder[side][i] || {}) : {};
    const loN = Object.values(lo).reduce((x, y) => x + y, 0);
    const cand = new Set([...Object.keys(slot), ...Object.keys(pool), ...Object.keys(meta)]);
    const out = [];
    const ALPHA = 4;   // smoothing: thin slot history leans on their overall habits
    cand.forEach(h => {
      if (!h || taken.has(h)) return;
      let lane = '';
      if (kind === 'pick') {
        const L = P.heroLane[h] || {}; const ls = Object.keys(L).filter(l => openLanes.includes(l)).sort((a, b) => L[b] - L[a]);
        if (Object.keys(L).length && !ls.length) return;                  // only plays a lane they've filled
        lane = ls[0] || '';
      }
      const pAny = (pool[h] || 0) / poolN;
      const pSlot = ((slot[h] || 0) + ALPHA * pAny) / (slotN + ALPHA);
      const pLane = kind === 'pick' && lane ? ((lo[lane] || 0) + 1) / (loN + 5) : 0.2;
      const mt = meta[h] || 0;
      const score = (pSlot + 0.01 * mt) * (kind === 'pick' ? 0.5 + 2.5 * pLane : 1);
      const why = [];
      if (slot[h]) why.push(`${SLOT_NAME(side, kind, i)} ${slot[h]}/${slotN} of their games`);
      if (kind === 'pick' && P.hero[h]) why.push(`played ${P.hero[h]}x${lane ? ' (' + lane + ')' : ''}`);
      if (kind === 'pick' && lane && loN >= 4 && (lo[lane] || 0) / loN >= 0.35) why.push(`${lane} usually goes at ${SLOT_NAME(side, kind, i)} (${lo[lane]}/${loN})`);
      if (kind === 'ban' && P.banAny[h]) why.push(`banned ${P.banAny[h]}x in ${P.n} games`);
      if (mt >= 0.4) why.push(`${Math.round(mt * 100)}% league presence`);
      if (score > 0) out.push({ hero: h, lane, score, why });
    });
    out.sort((a, b) => b.score - a.score);
    const tot = out.slice(0, 12).reduce((a, b) => a + b.score, 0) || 1;
    return { slot: SLOT_NAME(side, kind, i), sample: slotN, list: out.slice(0, opts.limit || 6).map(o => ({ ...o, prob: o.score / tot })) };
  };

  // Hero → lanes it's actually played in (for suggest()).
  D.lanePool = function (matches, min) {
    const L = {};
    (matches || []).forEach(m => ['blue', 'red'].forEach(s => (m[s + 'Picks'] || []).forEach(p => { const h = nm(p); if (!h || !p.lane) return; const x = L[h] || (L[h] = {}); x[p.lane] = (x[p.lane] || 0) + 1; })));
    const out = {};
    Object.entries(L).forEach(([h, x]) => { const ls = Object.keys(x).filter(l => x[l] >= (min || 2)); if (ls.length) out[h] = ls; });
    return out;
  };

  D.summary = function (model) {
    const bt = model.meta && model.meta.backtest;
    if (!bt || !bt.draft) return `Draft model: ${model.n} games${model.meta.note ? ' — ' + model.meta.note : ''} (no back-test yet — needs ~75+ games).`;
    const pc = x => Math.round(x * 100);
    return `Draft model trained on ${model.n} games (${model.meta.dates.join(' to ')}). Back-test on the newest ${bt.test} games: draft model ${pc(bt.draft.acc)}% correct (log-loss ${bt.draft.logloss.toFixed(3)}) vs team strength alone ${pc(bt.base.acc)}% (${bt.base.logloss.toFixed(3)}) vs coin flip ${bt.coin.logloss.toFixed(3)}.${bt.draft.logloss < bt.base.logloss - 0.005 ? ' The draft terms add real signal.' : ' The draft terms add little over team strength on this data — treat draft deltas as hints.'}`;
  };

  root.WDraft = D;
})(typeof window !== 'undefined' ? window : globalThis);
