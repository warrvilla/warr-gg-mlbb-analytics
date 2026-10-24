// ═══════════════════════════════════════════════════════════════
// Warr.GG — /api/hero-data
//   GET                 hero kits + recent patch notes (lite: no long skill text)
//   GET ?full=1         with every skill description (Heimer uses this)
//   GET ?status=1       when it last refreshed, what changed, any error
//   POST {action:'refresh'}   admin only — refresh from Liquipedia now
// Data: Liquipedia (CC-BY-SA 3.0), refreshed every 6 h by hero-data-refresh.
// ═══════════════════════════════════════════════════════════════
import { refresh, openStore } from '../lib/hero-data.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqqlmzdyyhbyvsbybdem.supabase.co';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'wrrenvillapando@gmail.com').toLowerCase();
const cors = () => ({ 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-supabase-anon' });

// Self-healing: if the data was never loaded (fresh deploy) or the 6-hourly job
// stopped running, the first visitor's request loads it (one at a time, locked).
async function heal(store, stale) {
  if (!stale) return false;
  const lock = await store.get('lock', { type: 'json' });
  if (lock && Date.now() - lock.at < 90e3) return false;            // someone else is refreshing
  await store.setJSON('lock', { at: Date.now() });
  try { await refresh({ store, budgetMs: 19000 }); } catch (e) { console.error('hero-data heal', e); }
  await store.setJSON('lock', { at: 0 });
  return true;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  const store = await openStore();
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('status')) {
      return Response.json((await store.get('status', { type: 'json' })) || { never: true }, { headers: { ...cors(), 'cache-control': 'no-store' } });
    }
    const key = url.searchParams.get('full') ? 'payload' : 'payload-lite';
    let body = await store.get(key);
    const st = await store.get('status', { type: 'json' });
    const age = st && st.at ? Date.now() - Date.parse(st.at) : Infinity;
    const stale = !body || age > 12 * 3600e3 || (st && st.partial && age > 60e3) || (st && !st.ok && age > 15 * 60e3);
    if (await heal(store, stale)) body = await store.get(key);
    if (!body) {
      const s2 = await store.get('status', { type: 'json' });
      return Response.json({ v: 1, empty: true, loading: true, error: (s2 && s2.error) || null, heroes: {}, patches: [], calendar: [] }, { headers: { ...cors(), 'cache-control': 'no-store' } });
    }
    return new Response(body, { headers: { ...cors(), 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=900', 'netlify-vary': 'query=full', 'netlify-cdn-cache-control': 'public, s-maxage=900, stale-while-revalidate=86400' } });
  }
  if (req.method !== 'POST') return Response.json({ error: 'GET or POST' }, { status: 405, headers: cors() });
  // Refresh now: admin only (verified against Supabase auth, not a header claim).
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const anon = req.headers.get('x-supabase-anon') || '';
  if (!token || !anon) return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers: cors() });
  let email = '';
  try {
    const v = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    if (!v.ok) return Response.json({ error: 'INVALID_SESSION' }, { status: 401, headers: cors() });
    email = ((await v.json())?.email || '').toLowerCase();
  } catch { return Response.json({ error: 'AUTH_CHECK_FAILED' }, { status: 401, headers: cors() }); }
  if (email !== ADMIN_EMAIL) return Response.json({ error: 'ADMIN_ONLY' }, { status: 403, headers: cors() });
  let body = {}; try { body = await req.json(); } catch {}
  if (body.action !== 'refresh') return Response.json({ error: 'UNKNOWN_ACTION' }, { status: 400, headers: cors() });
  const status = await refresh({ store, budgetMs: 21000, force: !!body.force });
  return Response.json(status, { headers: { ...cors(), 'cache-control': 'no-store' } });
};

export const config = { path: '/api/hero-data' };
