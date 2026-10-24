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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  const store = await openStore();
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('status')) {
      return Response.json((await store.get('status', { type: 'json' })) || { never: true }, { headers: { ...cors(), 'cache-control': 'no-store' } });
    }
    const body = await store.get(url.searchParams.get('full') ? 'payload' : 'payload-lite');
    if (!body) return Response.json({ v: 1, empty: true, heroes: {}, patches: [], calendar: [] }, { headers: { ...cors(), 'cache-control': 'public, max-age=300' } });
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
