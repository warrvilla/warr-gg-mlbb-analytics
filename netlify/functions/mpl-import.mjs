// ═══════════════════════════════════════════════════════════════
// Warr.GG — /api/mpl-import  (MPL games from Liquipedia → scout database)
//   GET ?status=1                         last check: new games, already-logged, review list
//   POST {action:'preview'}               admin — read Liquipedia, show what would be added
//   POST {action:'import'}                admin — add the new games (never touches yours)
//   POST {action:'auto', on:true|false}   admin — keep importing automatically (live on match days)
//   POST {action:'team', league, liquipedia, site}   admin — how a Liquipedia team is named here
// ═══════════════════════════════════════════════════════════════
import { run, setOption, openStore } from '../lib/mpl-import.mjs';
import { openStore as heroStore } from '../lib/hero-data.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqqlmzdyyhbyvsbybdem.supabase.co';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'wrrenvillapando@gmail.com').toLowerCase();
const cors = () => ({ 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, x-supabase-anon', 'cache-control': 'no-store' });

export async function heroTitles() {
  try { const p = await (await heroStore()).get('payload-lite', { type: 'json' }); return p && p.heroes ? Object.keys(p.heroes) : []; } catch { return []; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  const store = await openStore();
  if (req.method === 'GET') {
    const st = (await store.get('status', { type: 'json' })) || { never: true };
    const state = (await store.get('state', { type: 'json' })) || {};
    return Response.json({ ...st, auto: !!state.auto }, { headers: cors() });
  }
  if (req.method !== 'POST') return Response.json({ error: 'GET or POST' }, { status: 405, headers: cors() });
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
  if (body.action === 'preview' || body.action === 'import') {
    const r = await run({ store, apply: body.action === 'import', budgetMs: 21000, heroTitles: await heroTitles() });
    return Response.json(r, { headers: cors() });
  }
  if (body.action === 'auto') return Response.json(await setOption(store, { auto: !!body.on }), { headers: cors() });
  if (body.action === 'team') return Response.json(await setOption(store, { team: { league: body.league, liquipedia: body.liquipedia, site: body.site } }), { headers: cors() });
  return Response.json({ error: 'UNKNOWN_ACTION' }, { status: 400, headers: cors() });
};

export const config = { path: '/api/mpl-import' };
