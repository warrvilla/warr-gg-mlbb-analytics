// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — MPL games from Liquipedia → the scout database.
//
// Reads the current and previous season of every MPL league (PH, ID, MY, SG,
// KH) — the season list is discovered, so Season 19 is picked up by itself.
// Each finished game brings: teams, side, winner, length, date, game number,
// stage/week, map pick, VOD, bans and picks with lanes. Draft ORDER is not
// trusted: picks are listed in lane order and ban order isn't confirmed either.
//
// Liquipedia lists picks in LANE order (EXP, Jungle, Mid, Gold, Roam), not pick
// order, so imported games carry  pickOrder: 'lane'  until you fix and save them
// in Scout entry. The engines skip order-dependent learning for those games.
//
// Never doubles your data: a game already on Warr.GG (same heroes, or same teams
// + date + game number) is skipped and never changed. Imported games you edited
// are never touched again; unedited imports follow Liquipedia's corrections.
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
  const label = {};
  for (const m of String(raw || '').matchAll(/<!--\s*([^<>]{3,60}?)\s*-->\s*\|\s*(R\d+M\d+)\s*=/g)) label[m[2]] = m[1].trim();
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
      const mapTxt = plain(M.comment || ''), mm = /picked\s+(.+?)\s*$/i.exec(mapTxt);
      const map = mm ? (MAPS[norm(mm[1])] || mm[1].trim()) : '';
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
        pickOrder: 'lane', banOrder: 'unconfirmed', ...(sideUnknown ? { sideUnknown: true } : {}),   // draft order unconfirmed until you verify it
        lp: { src: 'liquipedia', page, key: `${key}#${gn}`, team1: o1, team2: o2, ...(P.mvp ? { mvp: plain(P.mvp) } : {}) },
      };
      games.push(g);
    });
    return date;
  };
  const walk = (list, ctx) => list.forEach(t => {
    const nm = t.name.toLowerCase(), P = t.params;
    if (nm === 'matchlist') {
      const title = plain(P.title || '').trim();
      let header = '', dayDate = '';
      Object.keys(P).filter(k => /^m\d+$/i.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).forEach(k => {
        const n = Number(k.slice(1));
        if (P[`m${n}header`]) { header = plain(P[`m${n}header`]).trim(); dayDate = ''; }
        const mt = templates(String(P[k] || ''))[0];
        if (mt && /^match$/i.test(mt.name)) dayDate = readMatch(mt.params, `${P.id || title}:${k.toUpperCase()}`, [title, header].filter(Boolean).join(' ') || ctx.week, pageStage, dayDate) || dayDate;
      });
      return;
    }
    if (nm.startsWith('bracket')) {
      Object.keys(P).filter(k => /^r\d+m\d+$/i.test(k)).forEach(k => {
        const K = k.toUpperCase(), lab = label[K] || plain(P[`r${K.match(/R(\d+)/)[1]}m1header`] || '') || `Round ${K.match(/R(\d+)/)[1]}`;
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
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
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
const CMP = ['league', 'season', 'stage', 'week', 'seriesFormat', 'gameNum', 'blueTeam', 'redTeam', 'winner', 'date', 'duration', 'vodLink', 'map', 'blueBans', 'redBans', 'bluePicks', 'redPicks', 'sideUnknown'];

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
  const out = { add: [], update: [], already: 0, editedSkip: 0, same: 0, conflicts: [], perSeason: {} };
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
  // pass 2: classify
  lpGames.forEach(g0 => {
    const g = { ...g0, blueTeam: tname(g0.league, g0.blueTeam), redTeam: tname(g0.league, g0.redTeam) };
    const own = byId[g.id];
    if (own) {                                                  // imported before
      if (own.d.lp && own.d.lp.edited) { out.editedSkip++; return; }
      const changed = CMP.filter(k => JSON.stringify(own.d[k] ?? null) !== JSON.stringify(g[k] ?? null));
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
    if (hit) {                                                  // you logged it: never re-add, never change
      claimed.add(hit.id);
      out.already++; inc(g, 'already');
      const sameSide = pickSet(hit.d.bluePicks) === pickSet(g.bluePicks) || norm(hit.d.blueTeam) === norm(g.blueTeam);
      const theirWinner = hit.d.winner === 'blue' ? hit.d.blueTeam : hit.d.redTeam, lpWinner = g.winner === 'blue' ? g.blueTeam : g.redTeam;
      const lpWinPicks = pickSet(g.winner === 'blue' ? g.bluePicks : g.redPicks), yourWinPicks = pickSet(hit.d.winner === 'blue' ? hit.d.bluePicks : hit.d.redPicks);
      const issues = [];
      if (lpWinPicks !== yourWinPicks && norm(theirWinner) !== norm(lpWinner)) issues.push(`winner: yours ${theirWinner}, Liquipedia ${lpWinner}`);
      if (!sameSide && !g.sideUnknown) issues.push('sides are swapped vs Liquipedia');
      const bansYou = [...(hit.d.blueBans || []), ...(hit.d.redBans || [])], bansLp = [...g.blueBans, ...g.redBans];
      if (bansYou.length && overlap(bansYou, bansLp) < Math.min(bansYou.length, bansLp.length)) issues.push(`bans differ (${bansYou.filter(b => !bansLp.map(norm).includes(norm(b))).join(', ')} vs ${bansLp.filter(b => !bansYou.map(norm).includes(norm(b))).join(', ')})`);
      if (g.date && hit.d.date && dayDiff(hit.d.date, g.date) >= 1) issues.push(`date: yours ${hit.d.date}, Liquipedia ${g.date}`);
      if (issues.length) out.conflicts.push({ id: hit.id, game: `${g.league} ${g.season} · ${g.date} · ${hit.d.blueTeam} vs ${hit.d.redTeam} G${hit.d.gameNum || g.gameNum}`, issues });
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
async function runInner({ apply = false, budgetMs = 22000, fetchImpl = fetch, now = () => Date.now(), store, db, heroTitles } = {}) {
  const st = (await store.get('state', { type: 'json' })) || { pages: {}, teamMap: {}, auto: false };
  st.pages = st.pages || {}; st.teamMap = st.teamMap || {};
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
  // nothing new on Liquipedia since the last import → skip the database entirely
  const sig = hash(JSON.stringify(lpGames.map(g => [g.id, g.winner, g.date, g.map, g.blueTeam, g.redTeam, g.duration, g.bluePicks.map(p => p.name).join(), g.blueBans.join()])) + JSON.stringify(st.teamMap));
  if (apply && !error && sig === st.appliedSig) {
    result = { ...prev, at: result.at, requests: result.requests, partial, nextMatch: result.nextMatch, upToDate: true, applied: false };
    await store.setJSON('state', st); await store.setJSON('status', { ...result, auto: !!st.auto });
    return { ...result, auto: !!st.auto };
  }
  if (!error && lpGames.length) {
    try {
      db = db || sb();
      const existing = await db.rows([...new Set(lpGames.map(g => g.league))], [...new Set(lpGames.map(g => g.season))]);
      const P = plan(lpGames, existing, { teamMap: st.teamMap, adminId: st.adminId });
      result = { ...result, add: P.add.length, update: P.update.length, already: P.already, editedSkip: P.editedSkip, same: P.same, perSeason: P.perSeason,
        conflicts: P.conflicts, newTeams: P.newTeams, unknownHeroes: [...(typeof heroName !== 'undefined' && heroName.unknown ? heroName.unknown : [])], preview: P.add.slice(0, 60).map(g => `${g.league} ${g.season} · ${g.stage}${g.week ? ' · ' + g.week : ''} · ${g.date} · ${g.blueTeam} vs ${g.redTeam} G${g.gameNum}${g.map ? ' · ' + g.map : ''}`) };
      if (apply && (P.add.length || P.update.length)) {
        if (!P.adminId) throw new Error('NO_ADMIN_ID');
        await db.upsert([...P.add.map(g => ({ id: g.id, data: g, created_by: P.adminId })), ...P.update.map(u => ({ id: u.row.id, data: u.row, created_by: u.by || P.adminId }))]);
        result.applied = true;
      }
      if (apply) st.appliedSig = sig;
      st.adminId = st.adminId || P.adminId;
    } catch (e) { result.error = String(e.message || e); }
  }
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
