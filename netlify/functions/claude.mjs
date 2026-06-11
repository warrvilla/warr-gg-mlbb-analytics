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

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqqlmzdyyhbyvsbybdem.supabase.co';
const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const MAX_TOKENS_CAP = 1200;

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
  try {
    const v = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anon, authorization: `Bearer ${token}` },
    });
    if (!v.ok) return Response.json({ error: 'INVALID_SESSION' }, { status: 401, headers: _cors() });
  } catch {
    return Response.json({ error: 'AUTH_CHECK_FAILED' }, { status: 401, headers: _cors() });
  }

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
  return new Response(await r.text(), {
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
