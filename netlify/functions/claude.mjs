// ═══════════════════════════════════════════════════════════════
// Warr.GG — server-side Claude proxy
//
// WHY THIS EXISTS: the Anthropic API key must never reach the browser.
// The old flow stored an XOR-obfuscated key in Supabase site_config and
// every visitor's browser could decode it (the salt ships in warr-lib.js).
// This function keeps the real key in a Netlify environment variable and
// only forwards requests from logged-in Warr.GG users.
//
// SETUP (one-time, Netlify dashboard):
//   Site configuration → Environment variables → add:
//     ANTHROPIC_API_KEY = sk-ant-...   (create a FRESH key — rotate the old one)
// ═══════════════════════════════════════════════════════════════

import { getStore } from '@netlify/blobs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqqlmzdyyhbyvsbybdem.supabase.co';
const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const MAX_TOKENS_CAP = 1200;

// ── HARD MONTHLY BUDGET (the owner's wallet guard) ──
// When the month's estimated spend reaches the cap, this function returns
// 429 and every client falls back to the free local Draft Brain. The bill
// cannot exceed the budget. Override via Netlify env vars if ever needed.
const BUDGET_PHP   = Number(process.env.MONTHLY_BUDGET_PHP || 5000);
const PHP_PER_USD  = Number(process.env.PHP_PER_USD || 59);
const BUDGET_USD   = BUDGET_PHP / PHP_PER_USD;          // ≈ $85 at default FX
const USER_DAILY_CALLS = Number(process.env.USER_DAILY_CALLS || 60);     // Pro accounts, per day
const TEAM_DAILY_CALLS = Number(process.env.TEAM_DAILY_CALLS || 200);    // Team accounts, per day
const FREE_MONTHLY_CALLS = Number(process.env.FREE_MONTHLY_CALLS || 10); // Free accounts, per MONTH (≈3 analyses + retries)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'wrrenvillapando@gmail.com';
// claude-sonnet pricing (USD per 1M tokens)
const PRICE_IN_PER_M  = 3;
const PRICE_OUT_PER_M = 15;

async function _readNum(store, key) {
  try { return Number(await store.get(key)) || 0; } catch { return 0; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: _cors() });
  }
  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405, headers: _cors() });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'PROXY_NOT_CONFIGURED' }, { status: 503, headers: _cors() });
  }

  // Require a valid Supabase session — the draft AI is for logged-in users,
  // and this is what stops random internet traffic from burning the key.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const anon = req.headers.get('x-supabase-anon') || '';
  if (!token || !anon) {
    return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers: _cors() });
  }
  let userId = 'anon', userEmail = '';
  try {
    const v = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anon, authorization: `Bearer ${token}` },
    });
    if (!v.ok) return Response.json({ error: 'INVALID_SESSION' }, { status: 401, headers: _cors() });
    try { const u = await v.json(); userId = u?.id || 'anon'; userEmail = u?.email || ''; } catch {}
  } catch {
    return Response.json({ error: 'AUTH_CHECK_FAILED' }, { status: 401, headers: _cors() });
  }

  // ── SERVER-SIDE PLAN CHECK — the client's local counter is UX only.
  // Plan comes from the profiles table via the user's own token (RLS lets
  // them read only their own row; migration 004 stops them changing it).
  const isAdmin = userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  let plan = 'free';
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan`, {
      headers: { apikey: anon, authorization: `Bearer ${token}` },
    });
    if (pr.ok) { const rows = await pr.json(); plan = (rows && rows[0] && rows[0].plan) || 'free'; }
  } catch {}
  const isPaid = isAdmin || plan === 'pro' || plan === 'team';

  // ── BUDGET + PER-USER GUARDS (fail-open if blob store hiccups) ──
  let store = null, monthKey = '', spentUSD = 0, userKey = '', userCalls = 0;
  try {
    store = getStore('warr-api-usage');
    monthKey = 'usd:' + new Date().toISOString().slice(0, 7);          // usd:2026-06
    // Free accounts burn a MONTHLY allowance; paid accounts a daily one.
    userKey = isPaid
      ? 'calls:' + new Date().toISOString().slice(0, 10) + ':' + userId
      : 'fcalls:' + new Date().toISOString().slice(0, 7) + ':' + userId;
    [spentUSD, userCalls] = await Promise.all([_readNum(store, monthKey), _readNum(store, userKey)]);
    if (spentUSD >= BUDGET_USD) {
      return Response.json({ error: 'BUDGET_EXCEEDED', detail: 'Monthly AI budget reached — the local Draft Brain takes over until next month.' }, { status: 429, headers: _cors() });
    }
    const dailyCap = plan === 'team' ? TEAM_DAILY_CALLS : USER_DAILY_CALLS;
    if (!isAdmin && isPaid && userCalls >= dailyCap) {
      return Response.json({ error: 'USER_DAILY_CAP', detail: 'Daily AI limit reached for this account — back tomorrow.' }, { status: 429, headers: _cors() });
    }
    if (!isPaid && userCalls >= FREE_MONTHLY_CALLS) {
      return Response.json({ error: 'FREE_PLAN_CAP', detail: 'Free plan AI allowance used this month — Pro (₱199/mo) unlocks 100 deep analyses. Upgrade in Profile.' }, { status: 429, headers: _cors() });
    }
  } catch { /* blobs unavailable — allow the request, never break the product */ }

  // Clamp the request shape — the proxy is for draft reasoning, nothing else.
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'BAD_JSON' }, { status: 400, headers: _cors() }); }
  const safe = {
    model: ALLOWED_MODELS.includes(body.model) ? body.model : ALLOWED_MODELS[0],
    max_tokens: Math.min(Math.max(1, body.max_tokens || 300), MAX_TOKENS_CAP),
    messages: Array.isArray(body.messages) ? body.messages.slice(0, 12) : [],
  };
  if (body.system && typeof body.system === 'string') safe.system = body.system.slice(0, 20000);
  if (!safe.messages.length) return Response.json({ error: 'NO_MESSAGES' }, { status: 400, headers: _cors() });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(safe),
  });
  const text = await r.text();

  // ── METER the actual spend from Anthropic's usage block ──
  if (store && r.ok) {
    try {
      const usage = JSON.parse(text)?.usage || {};
      const cost = ((usage.input_tokens || 0) * PRICE_IN_PER_M + (usage.output_tokens || 0) * PRICE_OUT_PER_M) / 1e6;
      await Promise.all([
        store.set(monthKey, String(spentUSD + cost)),
        store.set(userKey, String(userCalls + 1)),
      ]);
    } catch { /* metering failure must never break the response */ }
  }
  return new Response(text, {
    status: r.status,
    headers: { 'content-type': 'application/json', ...(_cors()) },
  });
};

function _cors() {
  // Same-origin in production; explicit headers keep local file:// testing sane.
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-supabase-anon',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

export const config = { path: '/api/claude' };
