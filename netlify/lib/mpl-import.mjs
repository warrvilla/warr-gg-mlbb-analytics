// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — MPL games from Liquipedia → the scout database.
//
// Reads the current and previous season of every MPL league (PH, ID, MY, SG,
// KH) — the season list is discovered, so Season 19 is picked up by itself.
// Each finished game brings: teams, side, winner, length, date, game number,
// stage/week, map pick, VOD, bans and picks with lanes. Draft ORDER is not
// trusted: picks are listed in lane order. Ban order IS the real order (matched
// 266/268 team ban lists in VOD-logged MPL PH S17 games).
//
// Liquipedia lists picks in LANE order (EXP, Jungle, Mid, Gold, Roam), not pick
// order, so imported games carry  pickOrder: 'lane'  until you fix and save them
// in Scout entry. The engines skip order-dependent learning for those games.
//
// Never doubles your data: a game already on Warr.GG (same heroes, or same teams
// + date + game number) is never re-added. On YOUR games (logged by you, or an
// import you arranged) Liquipedia takes precedence for the facts — bans (real
// order), date, game length, map, winner, sides; a missing VOD / week is filled
// in — but only when it is surely the same game: same league + season, 8+ of the
// 10 heroes match, AND the week number or date agrees (or both are playoffs).
// Every correction is logged with the old value and can be undone ("keep mine").
// Picks are never changed: a difference is flagged for you to check on the VOD.
// Unedited imports simply follow Liquipedia.
// Content: Liquipedia (CC-BY-SA 3.0).
// ═══════════════════════════════════════════════════════════════════════
import { templates, plain } from './liquipedia-parse.mjs';
import { API, UA } from './hero-data.mjs';

export const LEAGUES = [
  { site: 'MPL PH', lp: 'Philippines' }, { site: 'MPL ID', lp: 'Indonesia' }, { site: 'MPL MY', lp: 'Malaysia' },
  { site: 'MPL SG', lp: 'Singapore' }, { site: 'MPL KH', lp: 'Cambodia' },
];
const SEASONS = 2;                                   // current + previous
const LANES = ['EXP', 'Jungle', 'Mid', 'Gold', 'Roam'];
const GAP_MS = 2100;
const STORE = 'warr-mpl-import';
const MAPS = { flyingcloud: 'Flying Cloud', revealingwisps: 'Revealing Wisps', healingturtle: 'Healing Turtle', goldenturret: 'Golden Turret',
  dangerousgrass: 'Dangerous Grass', brokenwalls: 'Broken Walls', expandingriver: 'Expanding River', expandingrivers: 'Expanding River' };
// Bump when the page parser changes: every stored page is read again so old imports get the fix.
export const PARSER_V = 3;
// "Broken Walls" / "Dangerous Grasa" (typo) / "[[Flying Cloud]]" → the site's map name
export function mapName(raw) {
  const t = String(raw || '').replace(/\[\[|\]\]/g, '').trim(), k = norm(t);
  if (!k) return '';
  if (MAPS[k]) return MAPS[k];
  const hit = Object.keys(MAPS).find(x => k.length >= 7 && x.slice(0, 7) === k.slice(0, 7));
  return hit ? MAPS[hit] : '';
}
// the map from a game's |mapmode= (ID pages), else its comment ("ONPH picked [[Flying Cloud]]")
export function readMap(M) {
  const direct = mapName(plain(String((M && (M.mapmode || M.map)) || '')));
  if (direct) return direct;
  const c = plain(String((M && M.comment) || ''));
  const pk = /picked\s+(.+?)\s*$/i.exec(c); if (pk && mapName(pk[1])) return mapName(pk[1]);
  const any = Object.values(MAPS).find(n => new RegExp(n.replace(/\s+/g, '\\s*'), 'i').test(c));
  return any || '';
}
const HERO_ALIAS = { yss: 'Yi Sun-shin', yisunshin: 'Yi Sun-shin', popolandkupa: 'Popol & Kupa', popol: 'Popol & Kupa', popolkupa: 'Popol & Kupa',
  xborg: 'X.Borg', lapulapu: 'Lapu-Lapu', lapu: 'Lapu-Lapu', change: "Chang'e", luoyi: 'Luo Yi', yuzhong: 'Yu Zhong', yinn: 'Yin', gs: 'Gusion', yz: 'Yu Zhong', xb: 'X.Borg', ls: 'Lesley', pk: 'Popol & Kupa' };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export const norm = s => String((s && (s.name || s)) || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Liquipedia names → Warr.GG names ─────────────────────────────────────
// Some leagues' editors write short names ("Gatot", "Mino", "Yz", "Xb") — resolve
// them to one hero by a unique prefix or by initials; anything still unclear is flagged.
export function heroNamer(heroTitles) {
  const by = {}, list = [];
  (heroTitles || []).forEach(t => { const n = t === 'Popol and Kupa' ? 'Popol & Kupa' : t; by[norm(t)] = n; list.push(n); });
  const initials = n => String(n).split(/[^A-Za-z]+/).filter(Boolean).map(w => w[0].toLowerCase()).join('');
  const unknown = new Set();
  const f = raw => {
    const k = norm(raw); if (!k) return '';
    if (HERO_ALIAS[k]) return HERO_ALIAS[k];
    if (by[k]) return by[k];
    if (k.length >= 3) { const pre = list.filter(n => norm(n).startsWith(k)); if (pre.length === 1) return pre[0]; }
    const ini = list.filter(n => initials(n).length >= 2 && initials(n) === k); if (ini.length === 1) return ini[0];
    unknown.add(String(raw).trim());
    return String(raw).trim().replace(/\b\w/g, c => c.toUpperCase());
  };
  f.unknown = unknown;
  return f;
}
const SHORT = new Set(['onic', 'evos', 'rrq', 'btr', 'srg', 'tnc', 'tlph', 'tlid', 'ae', 'ap', 'id', 'ph', 'my', 'sg', 'kh', 'mpl', 'see', 'cfu']);
export function prettyTeam(raw) {
  const s = String(raw || '').trim();
  if (/[A-Z]/.test(s)) return s;
  return s.split(/\s+/).map(w => (SHORT.has(w.toLowerCase()) || w.length <= 2) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
export function parseDate(s) {
  const p = n => String(n).padStart(2, '0');
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})(?:\s*-\s*(\d{1,2}):(\d{2}))?/.exec(String(s || ''));   // "2026-04-03 - 13:00" (KH, SG pages)
  if (iso) return { date: `${iso[1]}-${p(iso[2])}-${p(iso[3])}`, time: iso[4] ? `${p(iso[4])}:${iso[5]}` : '' };
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})(?:\s*-\s*(\d{1,2}:\d{2}))?/.exec(String(s || ''));   // "October 21,2026 - 15:00"
  if (!m || !MONTHS[m[1].toLowerCase()]) return { date: '', time: '' };
  return { date: `${m[3]}-${p(MONTHS[m[1].toLowerCase()])}-${p(m[2])}`, time: m[4] ? p(m[4].split(':')[0]) + ':' + m[4].split(':')[1] : '' };
}

// ── Match schedule (any weekday): start times from every |date= on the page ──
const TZ = { SGT: 8, PHT: 8, PST: 8, MYT: 8, HKT: 8, WITA: 8, AWST: 8, WIB: 7, ICT: 7, WIT: 9, KST: 9, JST: 9, GST: 4, AST: 3, MSK: 3, CEST: 2, CET: 1, BST: 1, UTC: 0, GMT: 0, BRT: -3, EST: -5, EDT: -4, CST: -6, PDT: -7 };
export function parseSchedule(raw) {
  const out = [];
  for (const m of String(raw || '').matchAll(/\|\s*date\s*=\s*((?:[A-Za-z]{3}[a-z]*\.?\s+\d{1,2},?\s*\d{4}|\d{4}-\d{1,2}-\d{1,2})\s*-\s*\d{1,2}:\d{2})\s*(?:\{\{\s*Abbr\/([A-Za-z]+)\s*\}\})?/g)) {
    const { date, time } = parseDate(m[1]); if (!date || !time) continue;
    const off = TZ[(m[2] || 'SGT').toUpperCase()] ?? 8;
    const t = Date.parse(`${date}T${time}:00Z`) - off * 3600e3;
    if (t) out.push(t);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}
// Is a match on (15 min before start → 4 h after)? Then check every 5 min, else hourly.
export function due(state, status, nowMs) {
  const live = ((state && state.schedule) || []).some(t => nowMs >= t - 15 * 60e3 && nowMs <= t + 4 * 3600e3);
  const last = Date.parse((status && status.at) || 0) || 0;
  return { live, due: nowMs - last >= (live ? 4.5 * 60e3 : 55 * 60e3) };
}

// ── One season page → finished games ─────────────────────────────────────
export function parseSeasonPage(raw, { league, season, page, heroName }) {
  heroName = heroName || (x => x);
  // bracket round labels live in comments just before each match: <!-- Upper Bracket Quarterfinals --> |R1M1=
  // Liquipedia labels a bracket round once, on its first match (<!-- Upper Bracket Quarterfinals --> |R1M1=);
  // the next matches of the SAME round carry that label on (R1M2..R1M4 are quarterfinals too).
  const label = {}; let cur = null;
  const STAGE = /bracket|final|semi|quarter|grand|decider|elimination|upper|lower|play-?in|qualif|knockout|third/i;
  for (const m of String(raw || '').matchAll(/<!--\s*([^<>]{3,60}?)\s*-->|\|\s*(R(\d+)M\d+)\s*=/g)) {
    if (m[1] !== undefined) { if (STAGE.test(m[1]) && !/hero|pick|ban/i.test(m[1])) cur = { text: m[1].trim(), round: null }; }
    else if (cur) { if (cur.round === null) cur.round = m[3]; if (cur.round === m[3]) label[m[2]] = cur.text; else cur = null; }
  }
  const wt = String(raw || '').replace(/<!--[\s\S]*?-->/g, '');
  const pageStage = /\/Playoffs/i.test(page) ? 'Playoffs' : /\/Play-?ins?/i.test(page) ? 'Play-ins' : /\/Regular Season/i.test(page) ? 'Regular Season' : /Qualif/i.test(page) ? 'Qualifiers' : 'Regular Season';
  const games = [];
  const readMatch = (P, key, week, stage, fallbackDate) => {
    const team = o => { const t = templates(String(o || ''))[0]; return t ? String(t.params['1'] || '').trim() : ''; };
    const o1 = team(P.opponent1), o2 = team(P.opponent2);
    if (!o1 || !o2) return;
    let { date, time } = parseDate(P.date);
    if (!date && fallbackDate) date = fallbackDate;              // editor left it blank → same day as the match before it
    const bo = Number(P.bestof) || 0;
    Object.keys(P).filter(k => /^map\d+$/.test(k)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))).forEach(k => {
      const mp = templates(String(P[k] || ''))[0]; if (!mp) return;
      const M = mp.params, gn = Number(k.slice(3));
      const winner = String(M.winner || '').trim();
      const h = (t, i) => heroName(String(M[`t${t}h${i}`] || '').trim());
      const b = (t, i) => heroName(String(M[`t${t}b${i}`] || '').trim());
      const t1p = [1, 2, 3, 4, 5].map(i => h(1, i)), t2p = [1, 2, 3, 4, 5].map(i => h(2, i));
      if (!/^[12]$/.test(winner) || t1p.filter(Boolean).length < 5 || t2p.filter(Boolean).length < 5) return;   // not played / not filled in yet
      const s1 = String(M.team1side || '').trim().toLowerCase();
      const sideUnknown = s1 !== 'blue' && s1 !== 'red';
      const t1Blue = sideUnknown ? true : s1 === 'blue';
      const picks = arr => arr.map((name, i) => ({ name, lane: LANES[i] }));
      const bans = t => [1, 2, 3, 4, 5].map(i => b(t, i)).filter(Boolean);
      const map = readMap(M);
      const g = {
        id: 'lp_' + hash(`${league}|${season}|${page}|${key}|${gn}`),
        league, season, stage, week, seriesFormat: bo ? 'BO' + bo : '', gameNum: gn,
        blueTeam: t1Blue ? o1 : o2, redTeam: t1Blue ? o2 : o1,
        winner: (winner === '1') === t1Blue ? 'blue' : 'red',
        date, ...(time ? { time } : {}), ...(M.length ? { duration: String(M.length).trim() } : {}),
        vodLink: String(M.vod || '').trim(), notes: '', patch: '', map,
        blueBans: t1Blue ? bans(1) : bans(2), redBans: t1Blue ? bans(2) : bans(1),
        bluePicks: picks(t1Blue ? t1p : t2p), redPicks: picks(t1Blue ? t2p : t1p),
        objectives: { turtle: [], lord: [] },
        pickOrder: 'lane', ...(sideUnknown ? { sideUnknown: true } : {}),   // pick order unconfirmed until you arrange it
        lp: { src: 'liquipedia', page, key: `${key}#${gn}`, team1: o1, team2: o2, ...(P.mvp ? { mvp: plain(P.mvp) } : {}) },
      };
      games.push(g);
    });
    return date;
  };
  // section headings ("==={{HiddenSort|RS: Week 3}}===" → "Week 3") with their position, for match lists that have no title
  const heads = [...wt.matchAll(/^(=+)\s*(.+?)\s*\1\s*$/gm)].map(h => {
    const hs = /\{\{\s*HiddenSort\s*\|([^}]*)\}\}/i.exec(h[2]);
    return { at: h.index, text: (hs ? hs[1] : plain(h[2])).replace(/^[A-Z]{1,4}:\s*/, '').trim() };
  }).filter(h => h.text && !/^(detailed results|results|format|standings|participants|prize|broadcast|notes?|references?|group [a-z])$/i.test(h.text));
  const headingAt = pos => { let t = ''; for (const h of heads) { if (h.at < pos) t = h.text; else break; } return t; };
  const walk = (list, ctx) => list.forEach(t => {
    const nm = t.name.toLowerCase(), P = t.params;
    if (nm === 'matchlist') {
      const title = plain(P.title || '').trim() || (t.start != null ? headingAt(t.start) : '');   // no title → the heading above it
      let header = '', dayDate = '';
      Object.keys(P).filter(k => /^m\d+$/i.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).forEach(k => {
        const n = Number(k.slice(1));
        if (P[`m${n}header`]) { header = plain(P[`m${n}header`]).trim(); dayDate = ''; }
        const mt = templates(String(P[k] || ''))[0];
        if (mt && /^match$/i.test(mt.name)) dayDate = readMatch(mt.params, `${P.id || plain(P.title || '').trim()}:${k.toUpperCase()}`, [title, header].filter(Boolean).join(' ') || ctx.week || pageStage, pageStage, dayDate) || dayDate;
      });
      return;
    }
    if (nm.startsWith('bracket')) {
      Object.keys(P).filter(k => /^r\d+m\d+$/i.test(k)).forEach(k => {
        const K = k.toUpperCase(), hd = plain(P[`r${K.match(/R(\d+)/)[1]}m1header`] || '').trim();
        const lab = label[K] || (hd && !/^round\s*\d+$/i.test(hd) ? hd : pageStage);   // never a made-up "Round 2"
        const mt = templates(String(P[k] || ''))[0];
        if (mt && /^match$/i.test(mt.name)) readMatch(mt.params, `${P.id || 'bracket'}:${K}`, lab, /grand ?final/i.test(lab) ? 'Grand Finals' : pageStage);
      });
      return;
    }
    if (/^match$/i.test(nm)) { readMatch(P, `${ctx.week || 'match'}:${games.length}`, ctx.week, pageStage); return; }
    Object.values(P).forEach(v => { if (v && String(v).includes('{{')) walk(templates(String(v)), ctx); });
  });
  // week from headings for loose matches (e.g. "Week 3")
  walk(templates(wt), { week: '' });
  return games;
}

// ── Liquipedia I/O (polite: one request every 2.1 s, gzip, UA) ───────────
function client({ budgetMs, fetchImpl, now }) {
  const t0 = now(); let last = 0, n = 0;
  const call = async params => {
    if (now() - t0 + GAP_MS + 5000 > budgetMs) { const e = new Error('OUT_OF_TIME'); e.oot = true; throw e; }
    const wait = GAP_MS - (now() - last); if (last && wait > 0) await sleep(wait);
    const r = await fetchImpl(API + '?' + new URLSearchParams({ ...params, format: 'json', formatversion: '2' }), { headers: { 'user-agent': UA, 'accept-encoding': 'gzip' } });
    last = now(); n++;
    if (!r.ok) throw new Error('HTTP_' + r.status);
    const j = await r.json(); if (j && j.error) throw new Error('API_' + (j.error.code || 'error'));
    return j;
  };
  return { call, count: () => n };
}

// Which pages to read: current + previous season of each league (auto-advances).
async function discover(call) {
  const out = [];
  for (const L of LEAGUES) {
    const j = await call({ action: 'query', list: 'allpages', apprefix: `MPL/${L.lp}/Season `, apfilterredir: 'nonredirects', aplimit: '500' });
    const titles = ((j.query && j.query.allpages) || []).map(p => p.title);
    const seasons = [...new Set(titles.map(t => (/^MPL\/[^/]+\/Season (\d+)/.exec(t) || [])[1]).filter(Boolean).map(Number))].sort((a, b) => b - a).slice(0, SEASONS);
    seasons.forEach(sn => {
      const sub = titles.filter(t => new RegExp(`^MPL/${L.lp}/Season ${sn}/`).test(t) && !/Statistics|Qualifier|Broadcast|Media|Rosters?$/i.test(t));
      const pages = sub.length ? sub : titles.filter(t => t === `MPL/${L.lp}/Season ${sn}`);
      pages.forEach(p => out.push({ title: p, league: L.site, season: `Season ${sn}` }));
    });
  }
  return out;
}

// ── Supabase (service role: the import writes as the admin) ──────────────
function sb() {
  const url = process.env.SUPABASE_URL || 'https://nqqlmzdyyhbyvsbybdem.supabase.co', key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { const e = new Error('NOT_CONFIGURED: add SUPABASE_SERVICE_ROLE_KEY in Netlify env vars'); e.cfg = true; throw e; }
  // legacy service_role key is a JWT (apikey + Bearer); new "sb_secret_…" keys go in apikey only
  const h = /^sb_secret_/.test(key) ? { apikey: key, 'content-type': 'application/json' } : { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  return {
    async rows(leagues, seasons) {
      const out = []; const q = a => encodeURIComponent(a.map(l => `"${l}"`).join(','));
      for (let from = 0; ; from += 1000) {
        const r = await fetch(`${url}/rest/v1/scout_matches?select=id,data,created_by&data->>league=in.(${q(leagues)})${seasons && seasons.length ? `&data->>season=in.(${q(seasons)})` : ''}&order=id&offset=${from}&limit=1000`, { headers: h });
        if (!r.ok) throw new Error('SUPABASE_READ_' + r.status);
        const part = await r.json(); out.push(...part); if (part.length < 1000) break;
      }
      return out;
    },
    async upsert(rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const r = await fetch(`${url}/rest/v1/scout_matches?on_conflict=id`, { method: 'POST', headers: { ...h, prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 200)) });
        if (!r.ok) throw new Error('SUPABASE_WRITE_' + r.status + ' ' + (await r.text()).slice(0, 200));
      }
    },
  };
}

// ── Plan: what's new, what's already on Warr.GG (never re-added), what changed ──
const pickSet = ps => (ps || []).map(norm).filter(Boolean).sort().join(',');
const overlap = (a, b) => { const B = new Set((b || []).map(norm)); return (a || []).map(norm).filter(x => B.has(x)).length; };
const dayDiff = (a, b) => Math.abs((Date.parse(a) || 0) - (Date.parse(b) || 0)) / 864e5;
// the database stores objects with its own key order ({lane,name}) → compare key-order-independently
const stable = v => JSON.stringify(v ?? null, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x);
const CMP = ['league', 'season', 'stage', 'week', 'seriesFormat', 'gameNum', 'blueTeam', 'redTeam', 'winner', 'date', 'duration', 'vodLink', 'map', 'blueBans', 'redBans', 'bluePicks', 'redPicks', 'sideUnknown'];

// Swap a game's sides the way Scout's ⇄ does: teams, picks, bans, regions, towers, winner,
// first blood, phase winners, turtles / lords — every blue/red field moves with its team.
const flipSide = v => v === 'blue' ? 'red' : v === 'red' ? 'blue' : v;
export function flipSides(R) {
  const o = { ...R, blueTeam: R.redTeam, redTeam: R.blueTeam, bluePicks: R.redPicks, redPicks: R.bluePicks, blueBans: R.redBans, redBans: R.blueBans, winner: flipSide(R.winner) };
  if ('blueRegion' in R || 'redRegion' in R) { o.blueRegion = R.redRegion; o.redRegion = R.blueRegion; }
  if (R.towers && typeof R.towers === 'object') o.towers = { ...R.towers, blue: R.towers.red, red: R.towers.blue };
  if (R.firstBlood) o.firstBlood = flipSide(R.firstBlood);
  if (R.ourSide) o.ourSide = flipSide(R.ourSide);
  if (R.phaseWinners && typeof R.phaseWinners === 'object') o.phaseWinners = Object.fromEntries(Object.entries(R.phaseWinners).map(([k, v]) => [k, flipSide(v)]));
  if (R.objectives && typeof R.objectives === 'object') o.objectives = Object.fromEntries(Object.entries(R.objectives).map(([k, v]) => [k, Array.isArray(v) ? v.map(flipSide) : flipSide(v)]));
  return o;
}

export function plan(lpGames, existing, opts) {
  opts = opts || {};
  const teamMap = { ...(opts.teamMap || {}) };               // norm(liquipedia name) → Warr.GG name
  const votes = {};
  const site = existing.map(r => ({ id: r.id, d: r.data || {}, by: r.created_by }));
  const byId = {}; site.forEach(r => { byId[r.id] = r; });
  const manual = site.filter(r => !(r.d.lp && r.d.lp.src === 'liquipedia'));
  const tk = (league, name) => league + '|' + norm(name);             // team names are per league ("onic" in ID ≠ PH)
  const pickName = (league, lpName, siteName) => { const k = tk(league, lpName); (votes[k] = votes[k] || {})[siteName] = ((votes[k] || {})[siteName] || 0) + 1; };
  // one display form per Liquipedia team ("evil" / "Evil" / "EVIL" → the most used capitalised form)
  const forms = {}; lpGames.forEach(g => [g.blueTeam, g.redTeam].forEach(t => { const k = tk(g.league, t); (forms[k] = forms[k] || {})[t] = (forms[k][t] || 0) + 1; }));
  const canon = k => { const f = forms[k] || {}; const c = Object.entries(f).sort((a, b) => (/[A-Z]/.test(b[0]) - /[A-Z]/.test(a[0])) || b[1] - a[1])[0]; return c ? prettyTeam(c[0]) : ''; };
  const out = { add: [], update: [], fix: [], already: 0, editedSkip: 0, same: 0, conflicts: [], perSeason: {} };
  const known = opts.heroTitles && opts.heroTitles.length ? new Set(opts.heroTitles.map(norm)) : null;   // only real hero names may replace your bans
  const now = opts.now || Date.now();
  const inc = (g, k) => { const s = `${g.league} ${g.season}`; const x = out.perSeason[s] || (out.perSeason[s] = { add: 0, already: 0, update: 0 }); x[k]++; };
  // pass 1: find games already on Warr.GG (and learn team names from them)
  // one Liquipedia game ↔ at most one of your games: exact hero matches claim first, then near matches
  const matched = new Map(), claimed = new Set();
  const poolOf = g => manual.filter(r => !claimed.has(r.id) && r.d.league === g.league && String(r.d.season || '').trim() === g.season);
  const exact = g => poolOf(g).find(r => { const a = pickSet(r.d.bluePicks), b = pickSet(r.d.redPicks), x = pickSet(g.bluePicks), y = pickSet(g.redPicks); return (a === x && b === y) || (a === y && b === x); });
  const near = g => poolOf(g).find(r => (!g.date || dayDiff(r.d.date, g.date) <= 2) && overlap([...(r.d.bluePicks || []), ...(r.d.redPicks || [])], [...g.bluePicks, ...g.redPicks]) >= 8);
  [exact, near].forEach(finder => lpGames.forEach(g => {
    if (matched.has(g)) return;
    const hit = finder(g);
    if (hit) {
      matched.set(g, hit); claimed.add(hit.id);
      const swapped = pickSet(hit.d.bluePicks) !== pickSet(g.bluePicks) && overlap(hit.d.bluePicks, g.redPicks) >= 4;
      pickName(g.league, swapped ? g.redTeam : g.blueTeam, hit.d.blueTeam); pickName(g.league, swapped ? g.blueTeam : g.redTeam, hit.d.redTeam);
    }
  }));
  Object.entries(votes).forEach(([k, v]) => { if (!teamMap[k]) teamMap[k] = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]; });
  const tname = (league, raw) => teamMap[tk(league, raw)] || canon(tk(league, raw)) || prettyTeam(raw);
  const stageGrp = x => /grand/i.test(x || '') ? 'gf' : /play/i.test(x || '') ? 'po' : 'rs';
  // ── your game ↔ its Liquipedia game: correct the facts, flag what only the VOD can settle ──
  const secs = d => { const m = /^(\d{1,3}):(\d{2})$/.exec(String(d || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const nj = a => (a || []).map(norm).join(',');
  const banOk = bs => bs.length === 5 && bs.every(b => b && (!known || known.has(norm(b))));
  const flip = s => s === 'blue' ? 'red' : 'blue';
  const label = (R, g) => `${g.league} ${g.season} · ${g.date || R.date || ''} · ${R.blueTeam} vs ${R.redTeam} G${R.gameNum || g.gameNum}`;
  // which Liquipedia team is on YOUR blue side — by the heroes, and by the team names
  const orient = (R, g) => {
    const ob = overlap(R.bluePicks, g.bluePicks), orr = overlap(R.bluePicks, g.redPicks);
    const byPicks = ob !== orr ? orr > ob : null;
    const nb = norm(R.blueTeam), nr = norm(R.redTeam), gb = norm(g.blueTeam), gr = norm(g.redTeam);
    const byNames = (nb === gb || nr === gr) ? false : (nb === gr || nr === gb) ? true : null;
    const mixed = byPicks !== null && byNames !== null && byPicks !== byNames;   // your names say one team, your picks say the other
    return { byPicks, mixed, sw: byPicks !== null ? byPicks : !!byNames };
  };
  // the week / date must back the heroes up: same week number (Week 3 = Week 3), date within 2 days, or both in the playoffs
  const wkNo = w => { const m = /week\s*(\d+)/i.exec(String(w || '')); return m ? Number(m[1]) : null; };
  const isPO = (w, st) => /playoff|bracket|final|semi|quarter|play-?in/i.test(`${w || ''} ${st || ''}`);
  const backs = (R, g) => {
    if (!g.date || !R.date || dayDiff(R.date, g.date) <= 2) return true;
    const a = wkNo(R.week), b = wkNo(g.week);
    if (a != null && b != null) return a === b;
    return a == null && b == null && isPO(R.week, R.stage) && isPO(g.week, g.stage);
  };
  const yours = (row, g, heroesOk) => {
    let R = row.d;
    const ack = R.lpAck || {};
    const weekOk = backs(R, g), confident = heroesOk && weekOk;     // auto-correct only when heroes AND week/date agree
    const changes = [], set = {};
    let O = orient(R, g);
    // sides: Liquipedia knows them and yours are the other way round → flip the whole game (unless you kept yours)
    if (confident && !O.mixed && O.sw && !g.sideUnknown && ack.sides !== 'swapped') {
      changes.push({ f: 'sides', from: `${R.blueTeam} on blue`, to: `${R.redTeam} on blue` });
      R = flipSides(R); O = orient(R, g);
    }
    const { byPicks, mixed, sw } = O;
    const L = { bBans: sw ? g.redBans : g.blueBans, rBans: sw ? g.blueBans : g.redBans, bPicks: sw ? g.redPicks : g.bluePicks, rPicks: sw ? g.bluePicks : g.redPicks,
      winner: sw ? flip(g.winner) : g.winner };
    const put = (f, from, to) => { changes.push({ f, from, to }); };
    // Liquipedia's bans must make sense before they replace yours: 10 different heroes, none of them picked
    const lpB = [...L.bBans, ...L.rBans].map(norm), picked = new Set([...g.bluePicks, ...g.redPicks, ...(R.bluePicks || []), ...(R.redPicks || [])].map(norm).filter(Boolean));
    const banBad = new Set(lpB).size !== lpB.length ? 'a hero is banned twice' : lpB.some(b => picked.has(b)) ? `${[...L.bBans, ...L.rBans].filter(b => picked.has(norm(b))).join(', ')} was also picked` : '';
    const bansDiffer = banOk(g.blueBans) && banOk(g.redBans) && (nj(R.blueBans) !== nj(L.bBans) || nj(R.redBans) !== nj(L.rBans));
    const banSig = hash(nj(g.blueBans) + '|' + nj(g.redBans));            // Liquipedia's own sides → same fingerprint however your game is flipped
    if (confident) {
      if (bansDiffer && !mixed && !banBad && ack.bans !== banSig) {   // Liquipedia's bans are taken as correct (even if some move to the other team)       // ack: you pressed "keep my bans" for exactly these
        changes.push({ f: 'bans', from: [R.blueBans || [], R.redBans || []], to: [L.bBans, L.rBans], sig: banSig }); set.blueBans = [...L.bBans]; set.redBans = [...L.rBans];
      }
      if (g.date && R.date !== g.date) { put('date', R.date || '', g.date); set.date = g.date; }
      if (g.duration && secs(g.duration) != null && secs(R.duration) !== secs(g.duration)) { put('length', R.duration || '', g.duration); set.duration = g.duration; }
      if (g.map && norm(R.map) !== norm(g.map)) { put('map', R.map || '', g.map); set.map = g.map; }
      if (g.vodLink && !R.vodLink) { put('vod', '', g.vodLink); set.vodLink = g.vodLink; }
      if (g.week && (!String(R.week || '').trim() || (/^round\s*\d+$/i.test(R.week) && R.week !== g.week))) { put('week', R.week || '', g.week); set.week = g.week; }   // fill, or replace an old "Round N"
      if (g.seriesFormat && !R.seriesFormat) { put('format', '', g.seriesFormat); set.seriesFormat = g.seriesFormat; }
    }
    // flags — never changed for you
    const issues = [];
    const pickSig = hash(pickSet(g.bluePicks) + '|' + pickSet(g.redPicks));
    if (!confident && ack.picks !== pickSig) issues.push({ kind: 'match', text: !heroesOk
      ? `Only ${overlap([...(R.bluePicks || []), ...(R.redPicks || [])], [...g.bluePicks, ...g.redPicks])} of 10 heroes match Liquipedia's game — check it's the right game / game number. Nothing was auto-corrected.`
      : `The heroes match Liquipedia's game (${g.week || g.stage || '—'}, ${g.date || '—'}) but your week and date don't (${R.week || '—'}, ${R.date || '—'}) — check it's the right game. Nothing was auto-corrected.` });
    if (mixed && ack.teams !== pickSig) {
      const lpTeamOfYourBlue = byPicks ? g.redTeam : g.blueTeam;
      issues.push({ kind: 'teams', text: `team names and drafts don't line up — on Liquipedia, the draft you have under ${R.blueTeam} was ${lpTeamOfYourBlue}'s (Liquipedia: ${g.winner === 'blue' ? g.blueTeam : g.redTeam} won). Check which team picked what; bans were not changed.` });
    }
    if (confident && bansDiffer && !mixed && banBad && ack.bans !== banSig) issues.push({ kind: 'bans', yours: [R.blueBans || [], R.redBans || []], lp: [L.bBans, L.rBans],
      text: `bans — Liquipedia's look wrong (${banBad}), kept yours: you ${(R.blueBans || []).join(', ')} / ${(R.redBans || []).join(', ')} · Liquipedia ${L.bBans.join(', ')} / ${L.rBans.join(', ')}` });
    if (ack.picks !== pickSig) [['blue', R.bluePicks, L.bPicks, R.blueTeam], ['red', R.redPicks, L.rPicks, R.redTeam]].forEach(([side, mine, lp, team]) => {
      const M = (mine || []).map(p => p && (p.name || p)).filter(Boolean), Lp = lp.map(p => p.name);
      const onlyYou = M.filter(h => !Lp.map(norm).includes(norm(h))), onlyLp = Lp.filter(h => !M.map(norm).includes(norm(h)));
      if (onlyYou.length || onlyLp.length) issues.push({ kind: 'picks', side, team, yours: onlyYou, lp: onlyLp, text: `${team} picks — you have ${onlyYou.join(', ') || '—'}, Liquipedia has ${onlyLp.join(', ') || '—'}` });
    });
    const youWin = R.winner === 'blue' ? R.blueTeam : R.redTeam, lpWin = L.winner === 'blue' ? R.blueTeam : R.redTeam;
    if (!mixed && R.winner && R.winner !== L.winner && ack.winner !== g.winner) {
      if (confident) { changes.push({ f: 'winner', from: youWin, to: lpWin, sig: g.winner }); set.winner = L.winner; }   // Liquipedia's result wins
      else issues.push({ kind: 'winner', yours: youWin, lp: lpWin, text: `winner — you have ${youWin}, Liquipedia has ${lpWin}` });
    }
    if (mixed && confident && R.winner && ack.winner !== g.winner) {          // team mix-up: go by the TEAM Liquipedia says won
      const lpWinName = g.winner === 'blue' ? g.blueTeam : g.redTeam;
      const side = norm(R.blueTeam) === norm(lpWinName) ? 'blue' : norm(R.redTeam) === norm(lpWinName) ? 'red' : '';
      if (side && side !== R.winner) { changes.push({ f: 'winner', from: youWin, to: R[side + 'Team'], sig: g.winner }); set.winner = side; }
    }
    if (changes.length) {
      const log = { at: now, changes };
      out.fix.push({ id: row.id, row: { ...R, ...set, lpRef: { page: g.lp.page, key: g.lp.key }, lpFix: [...(R.lpFix || []), log].slice(-10) }, by: row.by, changes, game: label(R, g) });
    }
    if (issues.length) out.conflicts.push({ id: row.id, game: label(R, g), vod: R.vodLink || g.vodLink || '', issues, page: g.lp.page,
      ack: { picks: pickSig, teams: pickSig, bans: banSig, winner: g.winner, sides: sw ? 'swapped' : '' },
      // Liquipedia's version of the game, for Scout's "Liquipedia is right" (team names in your naming)
      lp: { blue: { team: g.blueTeam, picks: g.bluePicks.map(p => p.name), bans: [...g.blueBans] }, red: { team: g.redTeam, picks: g.redPicks.map(p => p.name), bans: [...g.redBans] },
        winner: g.winner, sideUnknown: !!g.sideUnknown, banOk: !banBad && banOk(g.blueBans) && banOk(g.redBans), sure: confident } });
  };
  // pass 2: classify
  lpGames.forEach(g0 => {
    const g = { ...g0, blueTeam: tname(g0.league, g0.blueTeam), redTeam: tname(g0.league, g0.redTeam) };
    const own = byId[g.id];
    if (own) {                                                  // imported before
      if (own.d.lp && own.d.lp.edited) { out.editedSkip++; yours(own, g, true); return; }   // you arranged it: it's yours now
      const changed = CMP.filter(k => stable(own.d[k]) !== stable(g[k]));
      if (changed.length) { out.update.push({ row: { ...own.d, ...g, id: g.id, seriesId: own.d.seriesId || g.seriesId, savedAt: Date.now() }, by: own.by, changed }); inc(g, 'update'); }
      else out.same++;
      return;
    }
    let hit = matched.get(g0);
    // same teams + same game number in the same stage within a week (your date may be off) → it's yours
    if (!hit) hit = manual.find(r => !claimed.has(r.id) && r.d.league === g.league && String(r.d.season || '').trim() === g.season && Number(r.d.gameNum || 1) === g.gameNum
      && [r.d.blueTeam, r.d.redTeam].map(norm).sort().join('|') === [g.blueTeam, g.redTeam].map(norm).sort().join('|')
      && (!g.date || !r.d.date || dayDiff(r.d.date, g.date) <= 1 || (dayDiff(r.d.date, g.date) <= 7 && stageGrp(r.d.stage) === stageGrp(g.stage)
        && overlap([...(r.d.bluePicks || []), ...(r.d.redPicks || [])], [...g.bluePicks, ...g.redPicks]) >= 5)));
    if (hit) {                                                  // you logged it: never re-added
      claimed.add(hit.id);
      out.already++; inc(g, 'already');
      yours(hit, g, overlap([...(hit.d.bluePicks || []), ...(hit.d.redPicks || [])], [...g.bluePicks, ...g.redPicks]) >= 8);
      return;
    }
    // new game: join the series you already logged (same teams/date/format), else its own series
    const sib = manual.find(r => r.d.league === g.league && String(r.d.season || '').trim() === g.season && r.d.date === g.date && (r.d.seriesFormat || '') === g.seriesFormat
      && [r.d.blueTeam, r.d.redTeam].map(norm).sort().join('|') === [g.blueTeam, g.redTeam].map(norm).sort().join('|'));
    g.seriesId = (sib && sib.d.seriesId) || ('sid_lp' + hash(`${g.league}|${g.season}|${g.lp.page}|${g.lp.key.split('#')[0]}`));
    g.savedAt = Date.now();
    out.add.push(g); inc(g, 'add');
  });
  // admin = whoever logged most official games (the import writes as them)
  const cnt = {}; site.forEach(r => { if (r.by) cnt[r.by] = (cnt[r.by] || 0) + 1; });
  out.adminId = opts.adminId || (Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || [])[0] || null;
  out.teamMap = teamMap;
  const nt = {}; out.add.forEach(g => [g.lp.team1, g.lp.team2].forEach(t => { const k = tk(g.league, t); if (!teamMap[k]) nt[k] = { league: g.league, liquipedia: t, saved_as: tname(g.league, t) }; }));
  out.newTeams = Object.values(nt);
  return out;
}

// ── Run: read Liquipedia (only changed pages), plan, optionally write ─────
export async function openStore() {
  if (globalThis.__warrMplStore) return globalThis.__warrMplStore;            // tests only
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: STORE, consistency: 'strong' });
}
export async function run(opts = {}) {
  const store = opts.store || await openStore();
  const lock = await store.get('lock', { type: 'json' });
  const t = (opts.now || Date.now)();
  if (lock && t - lock.at < 60e3) return { busy: true, ...((await store.get('status', { type: 'json' })) || {}) };
  await store.setJSON('lock', { at: t });
  try { return await runInner({ ...opts, store }); } finally { await store.setJSON('lock', { at: 0 }); }
}
async function runInner({ apply = false, force = false, budgetMs = 22000, fetchImpl = fetch, now = () => Date.now(), store, db, heroTitles } = {}) {
  const st = (await store.get('state', { type: 'json' })) || { pages: {}, teamMap: {}, auto: false };
  st.pages = st.pages || {}; st.teamMap = st.teamMap || {};
  if (st.parserV !== PARSER_V) { Object.values(st.pages).forEach(p => { p.revid = 0; }); st.parserV = PARSER_V; }   // parser improved → read every page again
  if (!db) {                                  // no database key → stop before asking Liquipedia for anything
    try { db = sb(); } catch (e) {
      const res = { at: new Date(now()).toISOString(), error: String(e.message || e), requests: 0, auto: !!st.auto };
      await store.setJSON('status', res); return res;
    }
  }
  const C = client({ budgetMs, fetchImpl, now });
  let partial = false, error = null;
  try {
    if (!st.list || now() - (st.list.at || 0) > 6 * 3600e3) st.list = { at: now(), pages: await discover(C.call) };
    const pages = st.list.pages;
    // revision check (one light request per 50 pages), then download only changed pages
    const stale = [];
    for (let i = 0; i < pages.length; i += 50) {
      const part = pages.slice(i, i + 50);
      const j = await C.call({ action: 'query', prop: 'revisions', rvprop: 'ids', titles: part.map(p => p.title).join('|') });
      ((j.query && j.query.pages) || []).forEach(p => { const rv = p.revisions && p.revisions[0]; const cur = st.pages[p.title]; if (rv && (!cur || cur.revid !== rv.revid)) stale.push(p.title); });
    }
    var heroName = heroNamer(heroTitles);
    for (let i = 0; i < stale.length; i += 8) {
      const part = stale.slice(i, i + 8);
      const j = await C.call({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: part.join('|') });
      ((j.query && j.query.pages) || []).forEach(p => {
        const rv = p.revisions && p.revisions[0]; if (!rv) return;
        const meta = pages.find(x => x.title === p.title) || {};
        const wt = (rv.slots && rv.slots.main && rv.slots.main.content) || '';
        st.pages[p.title] = { revid: rv.revid, league: meta.league, season: meta.season, games: parseSeasonPage(wt, { league: meta.league, season: meta.season, page: p.title, heroName }),
          schedule: parseSchedule(wt).filter(t => Math.abs(t - now()) < 60 * 864e5) };
      });
      await store.setJSON('state', st);
    }
  } catch (e) { if (e.oot) partial = true; else error = String(e.message || e); }
  const live = new Set((st.list && st.list.pages || []).map(p => p.title));
  Object.keys(st.pages).forEach(t => { if (!live.has(t)) delete st.pages[t]; });   // seasons that rolled off
  const lpGames = Object.values(st.pages).flatMap(p => p.games || []);
  st.schedule = [...new Set(Object.values(st.pages).flatMap(p => p.schedule || []))].sort((a, b) => a - b);
  const prev = (await store.get('status', { type: 'json' })) || {};
  let result = { at: new Date(now()).toISOString(), partial, error, requests: C.count(), lpGames: lpGames.length, pages: Object.keys(st.pages).length, applied: false,
    nextMatch: (st.schedule.find(t => t > now() - 4 * 3600e3) ? new Date(st.schedule.find(t => t > now() - 4 * 3600e3)).toISOString() : null) };
  // nothing new on Liquipedia and the database was checked < 30 min ago → skip it (your edits are re-checked every 30 min)
  const sig = hash(PARSER_V + JSON.stringify(lpGames.map(g => [g.id, g.winner, g.date, g.map, g.blueTeam, g.redTeam, g.duration, g.bluePicks.map(p => p.name).join(), g.blueBans.join(), g.redBans.join()])) + JSON.stringify(st.teamMap));
  if (apply && !force && !error && sig === st.appliedSig && now() - (st.appliedAt || 0) < 30 * 60e3) {
    result = { ...prev, at: result.at, requests: result.requests, partial, nextMatch: result.nextMatch, upToDate: true, applied: false };
    await store.setJSON('state', st); await store.setJSON('status', { ...result, auto: !!st.auto });
    return { ...result, auto: !!st.auto };
  }
  if (!error && lpGames.length) {
    try {
      db = db || sb();
      const existing = await db.rows([...new Set(lpGames.map(g => g.league))], [...new Set(lpGames.map(g => g.season))]);
      const P = plan(lpGames, existing, { teamMap: st.teamMap, adminId: st.adminId, heroTitles, now: now() });
      result = { ...result, add: P.add.length, update: P.update.length, fix: P.fix.length, already: P.already, editedSkip: P.editedSkip, same: P.same, perSeason: P.perSeason,
        fixPreview: P.fix.slice(0, 200).map(f => ({ id: f.id, game: f.game, changes: f.changes })),
        conflicts: P.conflicts, newTeams: P.newTeams, unknownHeroes: [...(typeof heroName !== 'undefined' && heroName.unknown ? heroName.unknown : [])], preview: P.add.slice(0, 60).map(g => `${g.league} ${g.season} · ${g.stage}${g.week ? ' · ' + g.week : ''} · ${g.date} · ${g.blueTeam} vs ${g.redTeam} G${g.gameNum}${g.map ? ' · ' + g.map : ''}`) };
      if (apply && (P.add.length || P.update.length || P.fix.length)) {
        if (!P.adminId) throw new Error('NO_ADMIN_ID');
        await db.upsert([...P.add.map(g => ({ id: g.id, data: g, created_by: P.adminId })), ...P.update.map(u => ({ id: u.row.id, data: u.row, created_by: u.by || P.adminId })),
          ...P.fix.map(f => ({ id: f.id, data: f.row, created_by: f.by || P.adminId }))]);
        result.applied = true;
        if (P.fix.length) st.fixLog = [...P.fix.map(f => ({ at: now(), id: f.id, game: f.game, changes: f.changes })), ...(st.fixLog || [])].slice(0, 400);
      }
      if (apply) { st.appliedSig = sig; st.appliedAt = now(); }
      st.adminId = st.adminId || P.adminId;
    } catch (e) { result.error = String(e.message || e); }
  }
  result.fixLog = (st.fixLog || []).slice(0, 400);                // every correction made to your games (old → new)
  await store.setJSON('state', st);
  await store.setJSON('status', { ...result, auto: !!st.auto });
  return { ...result, auto: !!st.auto };
}
export async function setOption(store, patch) {
  store = store || await openStore();
  const st = (await store.get('state', { type: 'json' })) || { pages: {}, teamMap: {} };
  if ('auto' in patch) st.auto = !!patch.auto;
  if (patch.team && patch.team.liquipedia && patch.team.league) {
    st.teamMap = st.teamMap || {}; const k = patch.team.league + '|' + norm(patch.team.liquipedia);
    if (patch.team.site) st.teamMap[k] = String(patch.team.site).replace(/[<>"'`\\]/g, '').trim().slice(0, 60); else delete st.teamMap[k];
  }
  await store.setJSON('state', st);
  return { auto: !!st.auto, teamMap: st.teamMap };
}
