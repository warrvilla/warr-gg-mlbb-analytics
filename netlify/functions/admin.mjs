import { getStore } from '@netlify/blobs';
// ═══════════════════════════════════════════════════════════════
// Warr.GG — admin control endpoint (service-role powered)
//
// Lets the ADMIN (verified by JWT email) do what the browser alone cannot:
//   delete_user — remove the AUTH account (not just the profile row)
//   set_plan    — set an ACCESS LEVEL (free=Member, pro=Analyst, team=Pro Team)
//                 for N months (0 = no end date); lapses back to Member
//   ai_usage    — this month's Claude spend: total, budget, per account
//   ban_user    — auth-level ban (login blocked), or unban
// Passwords are never visible to anyone — Supabase stores only hashes.
//
// SETUP: Netlify env var SUPABASE_SERVICE_ROLE_KEY
//        (Supabase → Settings → API → service_role secret)
// ═══════════════════════════════════════════════════════════════
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqqlmzdyyhbyvsbybdem.supabase.co';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'wrrenvillapando@gmail.com').toLowerCase();
const BUDGET_USD = Number(process.env.MONTHLY_BUDGET_PHP || 0) > 0
  ? Number(process.env.MONTHLY_BUDGET_PHP) / Number(process.env.PHP_PER_USD || 59)
  : Number(process.env.MONTHLY_BUDGET_USD || 6);

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers: cors() });

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) return Response.json({ error: 'NOT_CONFIGURED', detail: 'Add SUPABASE_SERVICE_ROLE_KEY in Netlify env vars.' }, { status: 503, headers: cors() });

  // Caller must be the admin — verified against Supabase auth, not a header claim.
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

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'BAD_JSON' }, { status: 400, headers: cors() }); }
  const { action, userId } = body || {};
  if (action === 'ai_usage') {
    try {
      const store = getStore('warr-api-usage');
      const month = new Date().toISOString().slice(0, 7);
      const total = Number(await store.get('usd:' + month)) || 0;
      const { blobs = [] } = await store.list({ prefix: `uusd:${month}:` });
      const users = await Promise.all(blobs.slice(0, 300).map(async b => ({
        userId: b.key.split(':').pop(), usd: Number(await store.get(b.key)) || 0,
      })));
      users.sort((a, b) => b.usd - a.usd);
      return Response.json({ ok: true, month, spentUSD: total, budgetUSD: BUDGET_USD, users }, { headers: cors() });
    } catch (e) {
      return Response.json({ error: 'USAGE_UNAVAILABLE', detail: String(e && e.message) }, { status: 500, headers: cors() });
    }
  }
  if (!action || !userId) return Response.json({ error: 'MISSING_PARAMS' }, { status: 400, headers: cors() });
  const svcHeaders = { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json' };

  try {
    if (action === 'delete_user') {
      // profiles row first (FK-safe), then the auth account itself
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE', headers: svcHeaders });
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: svcHeaders });
      if (!r.ok) return Response.json({ error: 'DELETE_FAILED', detail: await r.text() }, { status: 500, headers: cors() });
      return Response.json({ ok: true }, { headers: cors() });
    }
    if (action === 'set_plan') {
      const plan = ['free', 'pro', 'team'].includes(body.plan) ? body.plan : 'free';
      const months = Math.max(0, Math.min(24, Number(body.months) || 0));
      const expires = plan === 'free' || months === 0 ? null
        : new Date(Date.now() + months * 30 * 864e5).toISOString();
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH', headers: { ...svcHeaders, prefer: 'return=representation' },
        // Warr.GG is free now — every grant is complimentary (is_comp kept true
        // for non-Member levels so older revenue stats never count them).
        body: JSON.stringify({ plan, plan_expires_at: expires, is_comp: plan !== 'free' }),
      });
      if (!r.ok) return Response.json({ error: 'PLAN_FAILED', detail: await r.text() }, { status: 500, headers: cors() });
      return Response.json({ ok: true, plan, plan_expires_at: expires }, { headers: cors() });
    }
    if (action === 'ban_user') {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'PUT', headers: svcHeaders,
        body: JSON.stringify({ ban_duration: body.unban ? 'none' : '87600h' }), // 10 years | lift
      });
      if (!r.ok) return Response.json({ error: 'BAN_FAILED', detail: await r.text() }, { status: 500, headers: cors() });
      return Response.json({ ok: true, banned: !body.unban }, { headers: cors() });
    }
    return Response.json({ error: 'UNKNOWN_ACTION' }, { status: 400, headers: cors() });
  } catch (e) {
    return Response.json({ error: 'INTERNAL', detail: String(e && e.message) }, { status: 500, headers: cors() });
  }
};
function cors() {
  return { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, x-supabase-anon', 'access-control-allow-methods': 'POST, OPTIONS' };
}
export const config = { path: '/api/admin' };
