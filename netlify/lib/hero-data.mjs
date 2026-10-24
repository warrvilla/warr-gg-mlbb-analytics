// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — hero kits + patch notes from Liquipedia, kept fresh automatically.
//
// Every 6 hours (hero-data-refresh.mjs) this asks Liquipedia's API which hero
// pages and patch-note pages changed, downloads only those, reads them
// (liquipedia-parse.mjs) and saves the result in Netlify Blobs. The site reads
// it from /api/hero-data. Nothing to run by hand; admins can force a refresh.
//
// Polite by design: one request every 2.1 s, ≤ 50 titles per request, gzip,
// a descriptive User-Agent, and unchanged pages are never downloaded again.
// Content: Liquipedia, CC-BY-SA 3.0 — credited wherever it is shown.
// ═══════════════════════════════════════════════════════════════════════
import { parseHero, parsePatch, heroTraits, cmpPatch, patchKey } from './liquipedia-parse.mjs';

export const API = 'https://liquipedia.net/mobilelegends/api.php';
export const UA = 'WarrGG-HeroData/1.0 (https://warr-gg.one; MLBB analytics; checks hero and patch pages every 6 hours)';
const GAP_MS = 2100;
const KEEP_PATCHES = 18;           // ≈ the last 8–10 months of patches
const LIST_EVERY_MS = 24 * 3600e3;
const STORE = 'warr-hero-data';

class OutOfTime extends Error {}
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function openStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: STORE, consistency: 'strong' });
}

// Runs as much of the refresh as fits in budgetMs; picks up where it left off next time.
export async function refresh({ store, budgetMs = 22000, fetchImpl = fetch, force = false, now = () => Date.now() } = {}) {
  store = store || await openStore();
  const t0 = now(); let last = 0, requests = 0;
  const log = [];
  const call = async (params) => {
    if (now() - t0 + GAP_MS + 5000 > budgetMs) throw new OutOfTime('budget');
    const wait = GAP_MS - (now() - last); if (last && wait > 0) await sleep(wait);
    const url = API + '?' + new URLSearchParams({ ...params, format: 'json', formatversion: '2' });
    const r = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-encoding': 'gzip' } });
    last = now(); requests++;
    if (r.status === 429 || r.status === 503) throw new Error('RATE_LIMITED_' + r.status);
    if (!r.ok) throw new Error('HTTP_' + r.status);
    const j = await r.json();
    if (j && j.error) throw new Error('API_' + (j.error.code || 'error'));
    return j;
  };
  const st = (await store.get('state', { type: 'json' })) || {};
  st.heroes = st.heroes || {}; st.patches = st.patches || {};
  let changed = false, partial = false, error = null;
  try {
    // 1 · which heroes exist (new heroes appear automatically)
    if (force || !st.list || now() - (st.list.at || 0) > LIST_EVERY_MS) {
      const j = await call({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Hero', cmnamespace: '0', cmlimit: '500' });
      const titles = ((j.query && j.query.categorymembers) || []).map(m => m.title).filter(Boolean);
      // union with the old list: a short or partial answer never drops a hero
      if (titles.length) st.list = { at: now(), titles: [...new Set([...titles, ...((st.list && st.list.titles) || [])])] };
    }
    // 2 · the newest patch-note pages
    if (force || !st.patchList || now() - (st.patchList.at || 0) > 5 * 3600e3) {
      const j = await call({ action: 'query', list: 'allpages', apprefix: 'Patch ', apfilterredir: 'nonredirects', aplimit: '500' });
      const titles = ((j.query && j.query.allpages) || []).map(p => p.title).filter(t => /^Patch \d+\.\d+\.\d+[a-zA-Z]?$/.test(t)).sort(cmpPatch);
      if (titles.length) st.patchList = { at: now(), titles: titles.slice(-KEEP_PATCHES) };
    }
    const heroTitles = (st.list && st.list.titles) || [];
    const patchTitles = (st.patchList && st.patchList.titles) || [];
    // 3 · revision check → download only pages that changed (patches first: they say what changed)
    const need = async (titles, bucket, chunk) => {
      const known = titles.filter(t => bucket[t]);
      let stale = titles.filter(t => !bucket[t]);
      for (let i = 0; i < known.length; i += 50) {
        const part = known.slice(i, i + 50);
        const j = await call({ action: 'query', prop: 'revisions', rvprop: 'ids', titles: part.join('|') });
        ((j.query && j.query.pages) || []).forEach(p => { const rv = p.revisions && p.revisions[0]; if (rv && bucket[p.title] && bucket[p.title].revid !== rv.revid) stale.push(p.title); });
      }
      stale = [...new Set(stale)];
      for (let i = 0; i < stale.length; i += chunk) {
        const part = stale.slice(i, i + chunk);
        const j = await call({ action: 'query', prop: 'revisions', rvprop: 'content|ids|timestamp', rvslots: 'main', titles: part.join('|') });
        ((j.query && j.query.pages) || []).forEach(p => {
          const rv = p.revisions && p.revisions[0]; if (!rv) return;
          const wt = (rv.slots && rv.slots.main && rv.slots.main.content) || rv.content || '';
          bucket[p.title] = { revid: rv.revid, edited: rv.timestamp, data: bucket === st.heroes ? parseHero(wt) : parsePatch(wt, p.title) };
          changed = true; log.push((bucket === st.heroes ? 'hero ' : 'patch ') + p.title);
        });
        await store.setJSON('state', st);                       // keep progress even if time runs out
      }
    };
    if (force || !st.checked || now() - st.checked > 3 * 3600e3 || patchTitles.some(t => !st.patches[t]) || heroTitles.some(t => !st.heroes[t])) {
      await need(patchTitles, st.patches, 8);
      await need(heroTitles, st.heroes, 50);
      st.checked = now();
    }
  } catch (e) {
    if (e instanceof OutOfTime) partial = true; else error = String(e.message || e);
  }
  await store.setJSON('state', st);
  if (changed || !(await store.get('payload-lite'))) await savePayload(store, st, now);
  const status = { at: new Date(now()).toISOString(), ok: !error, partial, error, requests, ms: now() - t0,
    heroes: Object.keys(st.heroes).length, patches: Object.keys(st.patches).length, changed: log.slice(0, 60) };
  await store.setJSON('status', status);
  return status;
}

function buildPayload(st, nowMs, lite) {
  const heroes = {};
  Object.entries(st.heroes).forEach(([title, h]) => {
    const d = h.data || {};
    heroes[title] = { info: d.info, stats: d.stats, traits: heroTraits(d), edited: h.edited,
      skills: (d.skills || []).map(s => lite ? { slot: s.slot, name: s.name, types: s.types, cd: s.cd } : s) };
  });
  const patches = Object.entries(st.patches).map(([title, p]) => ({ title, edited: p.edited, ...(p.data || {}) }))
    .filter(p => patchKey(p.title)).sort((a, b) => cmpPatch(b.title, a.title))
    .map(p => lite ? { ...p, heroes: (p.heroes || []).map(h => ({ hero: h.hero, type: h.type, score: h.score, note: h.note.slice(0, 160),
      slots: h.slots.map(s => ({ slot: s.slot, name: s.name, type: s.type, dir: s.dir, size: s.size, changes: s.changes.slice(0, 4) })) })) } : p);
  return { v: 1, lite: !!lite, source: 'Liquipedia', url: 'https://liquipedia.net/mobilelegends', license: 'CC-BY-SA 3.0',
    updated: new Date(nowMs).toISOString(), heroes, patches, calendar: patches.filter(p => p.release).map(p => [p.name, p.release]).reverse() };
}

async function savePayload(store, st, now) {
  await store.setJSON('payload', buildPayload(st, now(), false));
  await store.setJSON('payload-lite', buildPayload(st, now(), true));
}
