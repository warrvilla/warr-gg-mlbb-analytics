// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — WDraft: a draft model trained in the browser on logged games
//
//   WDraft.train(matches, opts)        → model   (well under a second for a few thousand games)
//   WDraft.score(model, draft, opts)   → { p, parts[], thin[] }   win chance for BLUE + why
//   WDraft.prob(model, draft, opts)    → p   (fast path, no explanation)
//   WDraft.suggest(model, draft, side, opts)  → best next picks (optionally with lookahead)
//   WDraft.reply(model, draft, side, pool)    → the opponent's best answer (for minimax)
//   WDraft.policy(matches, team)       → how a team actually drafts (slot habits)
//   WDraft.predict(policy, draft, team, side, kind, opts) → what that team will likely do next
//
// What it learns from (regularised logistic regression, recency-weighted):
//   • team strength (Bradley–Terry) + side — so draft terms measure what the
//     DRAFT adds beyond "the better team wins"
//   • every hero, lane-vs-lane matchups, same-team duos (shrunk hard: sparse)
//   • coach knowledge as general features — meta priority (pick/ban presence),
//     team comfort (how often THIS team played the hero before), off-lane picks,
//     curated counters/synergies, comp identity and comp-vs-comp (dive > poke >
//     teamfight > dive …), frontline / tank / damage mix
// The knowledge features start from coach priors (e.g. "no tank is bad",
// "teamfight beats dive") and the data moves them: with little data the model
// drafts like a sound coach; with more it trusts what the games show. Priors
// are dropped automatically if validation says they hurt. Every model is
// back-tested on the newest games before it's trusted.
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
  const LAMBDA = { side: 0.3, str: 0.02, h: 1, lv: 3, d: 4, c: 1, cx: 2, r: 1, k: 0.6 };
  const SCALES = [4, 12, 36, 108];
  // Coach priors (logit units). Fitting pulls each weight toward its prior, not 0.
  const PRIOR = {
    'k:presence': 0.35,     // per unit of summed pick/ban presence — priority heroes are strong
    'k:comfort': 0.06,      // per log(1+games) the team has on the hero
    'k:offlane': -0.25,     // per hero played outside its usual lanes
    'k:counter': 0.12,      // per curated counter relation won
    'k:synergy': 0.08,      // per curated synergy pair
    'r:noTank': 0.3, 'r:frontline': 0.12, 'r:magicMix': 0.12,
    'cx:dive>poke': 0.8, 'cx:dive>teamfight': -0.8, 'cx:poke>teamfight': 0.8, 'cx:pickoff>teamfight': -0.8, 'cx:dive>scale': 0.5,
  };
  const GROUP = k => k.slice(0, k.indexOf(':'));

  function roleMap(opts) {
    const out = {};
    const roster = (opts && opts.roster) || (root.WDB && root.WDB.HERO_ROSTER) || [];
    roster.forEach(h => { if (h && (h.n || h.name)) out[h.n || h.name] = h.r || h.role || ''; });
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
      if (/mm|marksman/.test(r)) c.mm += /^(mm|marksman)/.test(r) ? 1 : 0.5;
      if (/support/.test(r)) c.support += r.startsWith('support') ? 1 : 0.5;
    });
    return c;
  }

  // Sparse features for a (possibly partial) draft, from BLUE's point of view.
  // Everything except `side` is antisymmetric: swapping the teams flips the sign.
  // ctx: { R, roles, arch, K:{presence, laneShare, rel}, comfort(team, hero), noStrength }
  function features(dr, ctx) {
    const f = {};
    const add = (k, v) => { if (v) f[k] = (f[k] || 0) + v; };
    const bp = (dr.bluePicks || []).filter(p => nm(p)), rp = (dr.redPicks || []).filter(p => nm(p));
    add('side:blue', 1);
    if (!ctx.noStrength && ctx.R && dr.blueTeam && dr.redTeam && ctx.R.r[dr.blueTeam] != null && ctx.R.r[dr.redTeam] != null) add('str:rating', ctx.R.r[dr.blueTeam] - ctx.R.r[dr.redTeam]);
    bp.forEach(p => add('h:' + nm(p), 1));
    rp.forEach(p => add('h:' + nm(p), -1));
    LANES.forEach(l => {                                   // lane-vs-lane matchups
      const a = bp.find(p => p.lane === l), b = rp.find(p => p.lane === l);
      if (!a || !b) return;
      const x = nm(a), y = nm(b); if (x === y) return;
      if (x < y) add(`lv:${x}>${y}`, 1); else add(`lv:${y}>${x}`, -1);
    });
    const duo = (ps, sgn) => { for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const a = nm(ps[i]), b = nm(ps[j]); add(`d:${a < b ? a + '+' + b : b + '+' + a}`, sgn); } };
    duo(bp, 1); duo(rp, -1);
    // ── coach knowledge ──
    const K = ctx.K || {};
    if (K.presence) add('k:presence', bp.reduce((s, p) => s + (K.presence[nm(p)] || 0), 0) - rp.reduce((s, p) => s + (K.presence[nm(p)] || 0), 0));
    if (ctx.comfort) {
      const cf = (team, ps) => team ? ps.reduce((s, p) => s + Math.log1p(ctx.comfort(team, nm(p)) || 0), 0) : 0;
      add('k:comfort', cf(dr.blueTeam, bp) - cf(dr.redTeam, rp));
    }
    if (K.laneShare) {
      const off = ps => ps.filter(p => { const L = K.laneShare[nm(p)]; return p.lane && L && L._n >= 5 && (L[p.lane] || 0) < 0.15; }).length;
      add('k:offlane', off(bp) - off(rp));
    }
    if (K.rel) {
      const ctr = (a, b) => { const r = K.rel[b]; return r && r.counter && r.counter.includes(a) ? 1 : 0; };   // a counters b
      let c = 0; bp.forEach(a => rp.forEach(b => { c += ctr(nm(a), nm(b)) - ctr(nm(b), nm(a)); }));
      add('k:counter', c);
      const syn = ps => { let s = 0; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const a = nm(ps[i]), b = nm(ps[j]); if ((K.rel[a] && (K.rel[a].synergy || []).includes(b)) || (K.rel[b] && (K.rel[b].synergy || []).includes(a))) s++; } return s; };
      add('k:synergy', syn(bp) - syn(rp));
    }
    if (bp.length >= 3 && rp.length >= 3) {              // comp identity + comp-vs-comp + role balance
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

  // Knowledge tables from a set of games (no results used → no leakage).
  function knowledge(games, now, half, rel) {
    const pres = {}, lane = {}; let G = 0;
    games.forEach(m => {
      const w = Math.pow(0.5, ageDays(m.date, now) / half); G += w;
      ['blue', 'red'].forEach(s => {
        (m[s + 'Picks'] || []).forEach(p => { const h = nm(p); if (!h) return; pres[h] = (pres[h] || 0) + w; if (p.lane) { const L = lane[h] || (lane[h] = { _n: 0 }); L[p.lane] = (L[p.lane] || 0) + 1; L._n++; } });
        (m[s + 'Bans'] || []).forEach(b => { const h = nm(b); if (h) pres[h] = (pres[h] || 0) + w; });
      });
    });
    Object.keys(pres).forEach(h => { pres[h] = Math.min(1, pres[h] / (G || 1)); });
    Object.values(lane).forEach(L => Object.keys(L).forEach(k => { if (k !== '_n') L[k] = L[k] / L._n; }));
    return { presence: pres, laneShare: lane, rel: rel || null };
  }

  // Rows → compact typed arrays over a shared feature index.
  function compile(rows, index) {
    return rows.map(r => {
      const ks = Object.keys(r.x).filter(k => index.has(k));
      const id = new Int32Array(ks.length), v = new Float64Array(ks.length);
      ks.forEach((k, j) => { id[j] = index.get(k); v[j] = r.x[k]; });
      return { id, v, y: r.y, wt: r.wt };
    });
  }
  // Logistic regression, full-batch Adam, L2 toward the (scaled) coach priors.
  function fit(rows, keys, scale, iters, priorOn) {
    const n = keys.length, index = new Map(keys.map((k, i) => [k, i]));
    const C = compile(rows, index);
    const lam = new Float64Array(n), mu = new Float64Array(n);
    keys.forEach((k, i) => { const g = GROUP(k); lam[i] = (LAMBDA[g] || 1) * (g === 'side' || g === 'str' ? 1 : scale); mu[i] = priorOn ? (PRIOR[k] || 0) : 0; });
    const w = Float64Array.from(mu), m1 = new Float64Array(n), m2 = new Float64Array(n), g = new Float64Array(n);
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
        const gk = (g[i] + lam[i] * (w[i] - mu[i])) / W;
        m1[i] = b1 * m1[i] + (1 - b1) * gk; m2[i] = b2 * m2[i] + (1 - b2) * gk * gk;
        w[i] -= lr * (m1[i] / c1) / (Math.sqrt(m2[i] / c2) + 1e-8);
      }
    }
    const out = Object.create(null); keys.forEach((k, i) => { out[k] = w[i]; });
    return out;
  }
  // every knowledge/role/comp-vs-comp key exists even when no game triggered it,
  // so its prior still applies to new drafts
  const keysOf = (rows, filter) => { const s2 = new Set(); rows.forEach(r => Object.keys(r.x).forEach(k => { if (!filter || filter(k)) s2.add(k); })); if (!filter) Object.keys(PRIOR).forEach(k => s2.add(k)); return [...s2]; };
  const BASE = k => k.startsWith('side:') || k.startsWith('str:');
  const predictW = (w, x) => { let z = 0; for (const k in x) if (w[k] != null) z += w[k] * x[k]; return sig(z); };
  function evalSet(w, rows) {
    if (!rows.length) return null;
    let ll = 0, acc = 0, W = 0;
    rows.forEach(r => { const p = Math.min(1 - 1e-6, Math.max(1e-6, predictW(w, r.x))); ll += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)); if ((p >= 0.5) === (r.y === 1)) acc++; W++; });
    return { n: rows.length, logloss: ll / W, acc: acc / W };
  }
  // Pick regularisation scale + whether to keep the coach priors, on a
  // time-ordered validation split. Priors stay unless dropping them is clearly better.
  function tune(rows, iters, scales) {
    // two rolling windows (train on the first 60% → validate the next 20%,
    // first 80% → last 20%) so one noisy slice can't flip the decision
    const wins = [[0.6, 0.8], [0.8, 1]].map(([a, b]) => ({ tr: rows.slice(0, Math.floor(rows.length * a)), va: rows.slice(Math.floor(rows.length * a), Math.floor(rows.length * b)) })).filter(x => x.va.length >= 8);
    if (!wins.length) wins.push({ tr: rows.slice(0, Math.floor(rows.length * 0.8)), va: rows.slice(Math.floor(rows.length * 0.8)) });
    const res = [];
    (scales || SCALES).forEach(sc => [true, false].forEach(pr => {
      let ll = 0, n = 0;
      wins.forEach(wd => { const e = evalSet(fit(wd.tr, keysOf(wd.tr), sc, iters, pr), wd.va); if (e) { ll += e.logloss * e.n; n += e.n; } });
      if (n) res.push({ scale: sc, prior: pr, ll: ll / n });
    }));
    const bestOf = pr => res.filter(r => r.prior === pr).sort((a, b) => a.ll - b.ll)[0];
    const withP = bestOf(true), noP = bestOf(false);
    const pick = (noP && withP && noP.ll < withP.ll - 0.005) ? noP : (withP || noP);
    let bl = 0, bn = 0;
    wins.forEach(wd => { const e = evalSet(fit(wd.tr, keysOf(wd.tr, BASE), 1, iters, false), wd.va); if (e) { bl += e.logloss * e.n; bn += e.n; } });
    return { scale: pick.scale, prior: pick.prior, val: pick.ll, valBase: bn ? bl / bn : null };
  }

  D.train = function (matches, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const W = root.WIntel;
    const games = (matches || []).filter(usable).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const now = opts.now || Date.parse((games[games.length - 1] || {}).date || '') || Date.now();
    const half = opts.halfLifeDays || 180;
    const roles = roleMap(opts), arch = archOf(opts);
    const weightOf = typeof opts.weightOf === 'function' ? opts.weightOf : () => 1;
    const model = { version: 2, trainedAt: new Date().toISOString(), n: games.length, w: {}, counts: {}, R: null, roles, arch, K: null, comfort: {}, meta: {} };
    if (games.length < 20) { model.meta.note = 'Too few games to train (need 20+ with picks).'; model.K = knowledge(games, now, half, opts.relations); model.w = { ...PRIOR }; model.meta.priorOnly = true; return model; }
    const iters = opts.iters || 150;
    // Rows in time order; team comfort = games the team had on the hero BEFORE this one.
    const mk = (gs, R, K) => {
      const seen = {};
      const comfort = (t, h) => (seen[t] && seen[t][h]) || 0;
      return gs.map(m => {
        const x = features(m, { R, roles, arch, K, comfort });
        ['blue', 'red'].forEach(s => { const t = s === 'blue' ? m.blueTeam : m.redTeam; const T = seen[t] || (seen[t] = {}); (m[s + 'Picks'] || []).forEach(p => { const h = nm(p); if (h) T[h] = (T[h] || 0) + 1; }); });
        return { x, y: m.winner === 'blue' ? 1 : 0, wt: Math.pow(0.5, ageDays(m.date, now) / half) * weightOf(m) };
      });
    };
    // ── Back-test: tune + train on the older 80%, test on the newest 20% ──
    const cut = Math.max(10, Math.floor(games.length * 0.8));
    const trainG = games.slice(0, cut), testG = games.slice(cut);
    if (testG.length >= 15 && W) {
      const Rt = W.ratings(trainG), Kt = knowledge(trainG, now, half, opts.relations);
      const all = mk(games, Rt, Kt), tr = all.slice(0, cut), te = all.slice(cut);
      const tn = tune(tr, iters, opts.scales);
      const wFull = fit(tr, keysOf(tr), tn.scale, iters, tn.prior);
      const wBase = fit(tr, keysOf(tr, BASE), 1, iters, false);
      const wPrior = fit(tr, keysOf(tr), 1e6, 40, true);     // coach priors alone (no learning from data)
      model.meta.backtest = { train: tr.length, test: te.length, scale: tn.scale, prior: tn.prior, valDraft: tn.val, valBase: tn.valBase,
        draft: evalSet(wFull, te), base: evalSet(wBase, te), priorOnly: evalSet(wPrior, te),
        coin: { logloss: Math.log(2), acc: Math.max(te.filter(r => r.y === 1).length, te.filter(r => r.y === 0).length) / te.length } };
    }
    // ── Production model on everything ──
    const R = W ? W.ratings(games) : null;
    const K = knowledge(games, now, half, opts.relations);
    const rows = mk(games, R, K);
    const tn = model.meta.backtest ? { scale: model.meta.backtest.scale, prior: model.meta.backtest.prior } : tune(rows, iters, opts.scales);
    model.meta.scale = tn.scale; model.meta.prior = tn.prior;
    model.w = fit(rows, keysOf(rows), tn.scale, iters, tn.prior);
    model.R = R ? { r: R.r } : null;
    model.K = K;
    games.forEach(m => ['blue', 'red'].forEach(s => { const t = s === 'blue' ? m.blueTeam : m.redTeam; const T = model.comfort[t] || (model.comfort[t] = {}); (m[s + 'Picks'] || []).forEach(p => { const h = nm(p); if (h) T[h] = (T[h] || 0) + 1; }); }));
    rows.forEach(r => Object.keys(r.x).forEach(k => { model.counts[k] = (model.counts[k] || 0) + 1; }));
    model.meta.ms = Date.now() - t0;
    model.meta.dates = [(games[0] || {}).date || '', (games[games.length - 1] || {}).date || ''];
    return model;
  };

  const ctxOf = (model, opts) => ({ R: model.R, roles: model.roles, arch: model.arch, K: model.K, noStrength: !!(opts && opts.noStrength),
    comfort: (t, h) => (model.comfort[t] && model.comfort[t][h]) || 0 });

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
    if (g === 'k') return ({ presence: `${owner} drafted more priority heroes`, comfort: `${owner} on comfort heroes`, offlane: `${owner} has off-lane picks`,
      counter: `${owner} holds more counters`, synergy: `${owner} has more synergy pairs` })[body] + (good ? '' : ' (a minus here)');
    if (g === 'r') {
      if (body === 'noTank') return `${x > 0 ? 'red' : 'blue'} has no tank`;
      const nmR = ({ frontline: 'frontline', magicMix: 'magic + physical damage mix', assassins: 'assassin count' })[body] || body;
      return `${owner}'s ${nmR}${good ? '' : ' (a minus here)'}`;
    }
    return k;
  }

  D.prob = function (model, dr, opts) { return predictW(model.w, features(dr, ctxOf(model, opts))); };

  D.score = function (model, dr, opts) {
    const x = features(dr, ctxOf(model, opts));
    let z = 0; const parts = [];
    Object.keys(x).forEach(k => {
      const w = model.w[k]; if (w == null) return;
      const c = w * x[k]; z += c;
      if (Math.abs(c) < 1e-4) return;
      const g = GROUP(k);
      parts.push({ key: k, group: g, label: label(k, x[k], c), logit: c, side: c > 0 ? 'blue' : 'red', owner: x[k] > 0 ? 'blue' : 'red', n: model.counts[k] || 0, prior: PRIOR[k] != null });
    });
    const p = sig(z);
    parts.forEach(pt => { pt.pts = pt.logit * p * (1 - p) * 100; });   // ≈ win-% points
    parts.sort((a, b) => Math.abs(b.logit) - Math.abs(a.logit));
    return { p, z, parts, thin: parts.filter(pt => pt.n < 3 && !pt.prior && pt.group !== 'side' && pt.group !== 'str').map(pt => pt.label) };
  };

  const takenOf = dr => new Set([...(dr.bluePicks || []), ...(dr.redPicks || []), ...(dr.blueBans || []), ...(dr.redBans || [])].map(nm));
  const openOf = (dr, side) => LANES.filter(l => !(dr[side + 'Picks'] || []).some(p => p && p.lane === l));
  const withPick = (dr, side, hero, lane) => ({ ...dr, [side + 'Picks']: [...(dr[side + 'Picks'] || []), { name: hero, lane }] });
  const pSide = (model, dr, side, opts) => { const p = D.prob(model, dr, opts); return side === 'blue' ? p : 1 - p; };

  // The opponent's best single answer (by the model) from `pool` {hero:[lanes]}.
  D.reply = function (model, dr, side, pool, opts) {
    const taken = takenOf(dr), open = openOf(dr, side);
    let best = null;
    Object.keys(pool || {}).forEach(h => {
      if (taken.has(h)) return;
      (pool[h] || []).forEach(l => { if (!open.includes(l)) return; const v = pSide(model, withPick(dr, side, h, l), side, opts); if (!best || v > best.p) best = { hero: h, lane: l, p: v }; });
    });
    return best;
  };

  // Best heroes for `side`'s next pick: model gain vs the current draft.
  // opts.lookahead: also assume the opponent answers with their best reply
  // (minimax, depth 2) and rank by where that leaves us.
  D.suggest = function (model, dr, side, opts) {
    opts = opts || {};
    const taken = takenOf(dr), open = openOf(dr, side);
    const pool = opts.pool || {};
    const base = pSide(model, dr, side, opts);
    const out = [];
    Object.keys(pool).forEach(h => {
      if (taken.has(h)) return;
      (pool[h] || []).filter(l => open.includes(l)).forEach(l => out.push({ hero: h, lane: l, p: pSide(model, withPick(dr, side, h, l), side, opts) }));
    });
    const best = {}; out.forEach(o => { if (!best[o.hero] || best[o.hero].p < o.p) best[o.hero] = o; });
    let list = Object.values(best).sort((a, b) => b.p - a.p).slice(0, opts.limit ? Math.max(opts.limit, 10) : 10);
    const opp = side === 'blue' ? 'red' : 'blue';
    if (opts.lookahead && (dr[opp + 'Picks'] || []).length < 5) {
      list.forEach(o => {
        const nd = withPick(dr, side, o.hero, o.lane);
        const r = D.reply(model, nd, opp, opts.oppPool || pool, opts);
        o.reply = r ? r.hero : ''; o.replyLane = r ? r.lane : '';
        o.pAfter = r ? 1 - r.p : o.p;
      });
      list.sort((a, b) => b.pAfter - a.pAfter);
    }
    list = list.slice(0, opts.limit || 8);
    list.forEach(o => {
      o.gain = (o.pAfter != null ? o.pAfter : o.p) - base;
      o.n = model.counts['h:' + o.hero] || 0;
      const s = D.score(model, withPick(dr, side, o.hero, o.lane), opts);
      o.why = s.parts.filter(pt => pt.key.includes(o.hero) && pt.group !== 'h').slice(0, 2).map(pt => `${pt.label} ${(pt.pts >= 0) === (side === 'blue') ? '+' : '−'}${Math.abs(pt.pts).toFixed(1)}`);
    });
    return list;
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
      const laneOrdered = m.pickOrder === 'lane' || (picks.length === 5 && picks.map(p => p && p.lane).join(',') === LANES.join(','));
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
    const taken = takenOf(dr);
    const i = (kind === 'ban' ? (dr[side + 'Bans'] || []) : (dr[side + 'Picks'] || [])).length;
    const openLanes = openOf(dr, side);
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
    return { slot: SLOT_NAME(side, kind, i), sample: slotN, all: out, list: out.slice(0, opts.limit || 6).map(o => ({ ...o, prob: o.score / tot })), tot };
  };

  // Hero → lanes it's actually played in (for suggest()).
  D.lanePool = function (matches, min) {
    const L = {};
    (matches || []).forEach(m => ['blue', 'red'].forEach(s => (m[s + 'Picks'] || []).forEach(p => { const h = nm(p); if (!h || !p.lane) return; const x = L[h] || (L[h] = {}); x[p.lane] = (x[p.lane] || 0) + 1; })));
    const out = {};
    Object.entries(L).forEach(([h, x]) => { const ls = Object.keys(x).filter(l => x[l] >= (min || 2)); if (ls.length) out[h] = ls; });
    return out;
  };

  // How much to trust the draft terms (0.3 … 1), from the back-test.
  D.reliability = function (model) {
    const bt = model && model.meta && model.meta.backtest;
    if (!bt || !bt.draft || !bt.base) return 0.5;
    return Math.max(0.3, Math.min(1, 0.6 + (bt.base.logloss - bt.draft.logloss) * 20));
  };

  D.summary = function (model) {
    const bt = model.meta && model.meta.backtest;
    if (!bt || !bt.draft) return `Draft model: ${model.n} games${model.meta.note ? ' — ' + model.meta.note : ''}${model.meta.priorOnly ? ' Running on coach priors only.' : ' (no back-test yet — needs ~75+ games).'}`;
    const pc = x => Math.round(x * 100);
    const gain = bt.base.logloss - bt.draft.logloss;
    return `Draft model trained on ${model.n} games (${model.meta.dates.join(' to ')})${bt.prior ? ', coach priors on' : ', coach priors dropped (data disagreed)'}. Back-test on the newest ${bt.test} games: draft model ${pc(bt.draft.acc)}% correct (log-loss ${bt.draft.logloss.toFixed(3)}) vs team strength alone ${pc(bt.base.acc)}% (${bt.base.logloss.toFixed(3)})${bt.priorOnly ? `, coach priors without learning ${pc(bt.priorOnly.acc)}%` : ''}, coin flip ${bt.coin.logloss.toFixed(3)}.${gain > 0.005 ? ' The draft terms add real signal.' : gain > -0.005 ? ' The draft terms roughly match team strength alone — treat small draft deltas as hints.' : ' On this data the draft terms underperform team strength — lean on team form and game sense.'}`;
  };

  D.PRIOR = PRIOR;
  root.WDraft = D;
})(typeof window !== 'undefined' ? window : globalThis);
