// ═══════════════════════════════════════════════════════════════
// Warr.GG — server-side Claude proxy
//
// WHY THIS EXISTS: the Anthropic API key must never reach the browser.
// It lives in a Netlify environment variable and this function only
// forwards requests from logged-in Warr.GG users WHO HAVE AI ACCESS.
//
// SETUP (one-time, Netlify dashboard):
//   Site configuration → Environment variables → add:
//     ANTHROPIC_API_KEY = sk-ant-...
//
// ── ACCESS LEVELS ──────────────────────────────────────────────
// Warr.GG is free. Claude AI is invite-only so the API bill stays
// under control. The level is profiles.plan (values kept for
// compatibility — only the admin can change them, see migrations 004/006):
//
//   plan 'free' → MEMBER    whole site + local Draft Brain, no Claude AI
//                            (set FREE_MONTHLY_CALLS > 0 to give a trial)
//   plan 'pro'  → ANALYST   Claude AI on Sonnet 5.5, ANALYST_DAILY_CALLS/day
//   plan 'team' → PRO TEAM  Claude AI; full-draft ANALYSIS runs on Opus 5.5
//                            (OPUS_DAILY_CALLS/day, then Sonnet), TEAM_DAILY_CALLS/day
//   admin email → everything, no per-user cap
//
// The admin grants a level (optionally for N months) in Admin → Users.
// The MONTHLY BUDGET cap below is the last line of defence for everyone.
//
// Clients send `purpose: 'analysis'` for one-shot deep analyses (post-draft
// breakdown, draft strategy). Everything else is a fast "pick" call. The
// client's `model` field is ignored — the server decides.
// ═══════════════════════════════════════════════════════════════

import { getStore } from '@netlify/blobs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nqqlmzdyyhbyvsbybdem.supabase.co';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'wrrenvillapando@gmail.com';

// ── Models (override in Netlify env vars without touching code) ──
const MODEL_FAST = process.env.AI_MODEL_FAST || 'claude-sonnet-5-5';   // picks + Analyst analysis
const MODEL_DEEP = process.env.AI_MODEL_DEEP || 'claude-opus-5-5';     // Pro Team / admin analysis
const MODEL_SAFE = 'claude-sonnet-4-6';                                 // last-resort retry if a newer model/param is rejected
const EFFORT_PICK     = process.env.AI_EFFORT_PICK || 'low';            // live draft turns: keep them quick
const EFFORT_ANALYSIS = process.env.AI_EFFORT_ANALYSIS || 'medium';
// USD per 1M tokens. Thinking tokens are billed as output.
const PRICES = {
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5':   [4, 20],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5-20251001': [1, 5],
};
const WEB_SEARCH_USD = 0.01;   // $10 per 1,000 searches

// ── HARD MONTHLY BUDGET (the owner's wallet guard) ──
// When the month's metered spend reaches the cap, this function returns
// 429 and every client falls back to the free local Draft Brain.
const BUDGET_USD_CAP = Number(process.env.MONTHLY_BUDGET_USD || 6);
const PHP_PER_USD  = Number(process.env.PHP_PER_USD || 59);
const BUDGET_PHP   = Number(process.env.MONTHLY_BUDGET_PHP || 0);        // optional PHP override
const BUDGET_USD   = BUDGET_PHP > 0 ? BUDGET_PHP / PHP_PER_USD : BUDGET_USD_CAP;
const ANALYST_DAILY_CALLS = Number(process.env.ANALYST_DAILY_CALLS || process.env.USER_DAILY_CALLS || 30);
const TEAM_DAILY_CALLS    = Number(process.env.TEAM_DAILY_CALLS || 60);
const OPUS_DAILY_CALLS    = Number(process.env.OPUS_DAILY_CALLS || 15);   // per Pro Team account; then Sonnet
const FREE_MONTHLY_CALLS  = Number(process.env.FREE_MONTHLY_CALLS || 0);  // Members: 0 = no Claude AI

const LEVEL_LABEL = { free: 'Member', pro: 'Analyst', team: 'Pro Team', admin: 'Admin' };

// Netlify sync functions stop at 60s. Every Anthropic call gets a slice of a
// 55s deadline so a slow Opus answer still leaves room for one fast retry.
const DEEP_TIMEOUT_MS = 34000;
const FAST_TIMEOUT_MS = 24000;
const TOTAL_DEADLINE_MS = 55000;

async function _readNum(store, key) {
  try { return Number(await store.get(key)) || 0; } catch { return 0; }
}

function _err(status, error, detail, extra) {
  return Response.json({ error, detail, ...(extra || {}) }, { status, headers: _cors() });
}

export default async (req) => {
  const t0 = Date.now();
  const left = (ms) => Math.max(1000, Math.min(ms, TOTAL_DEADLINE_MS - (Date.now() - t0)));
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: _cors() });
  }
  if (req.method !== 'POST') return _err(405, 'POST only');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return _err(503, 'PROXY_NOT_CONFIGURED');

  // Require a valid Supabase session.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const anon = req.headers.get('x-supabase-anon') || '';
  if (!token || !anon) return _err(401, 'AUTH_REQUIRED');
  let userId = 'anon', userEmail = '';
  try {
    const v = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: anon, authorization: `Bearer ${token}` },
    });
    if (!v.ok) return _err(401, 'INVALID_SESSION');
    try { const u = await v.json(); userId = u?.id || 'anon'; userEmail = u?.email || ''; } catch {}
  } catch {
    return _err(401, 'AUTH_CHECK_FAILED');
  }

  // ── ACCESS LEVEL — read from the user's own profile row (RLS: own row only;
  // migration 004/006 stop users changing it themselves).
  const isAdmin = !!userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  let plan = 'free';
  try {
    const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,plan_expires_at,is_banned`, {
      headers: { apikey: anon, authorization: `Bearer ${token}` },
    });
    if (pr.ok) {
      const row = ((await pr.json()) || [])[0] || {};
      if (row.is_banned) return _err(403, 'BANNED');
      plan = ['pro', 'team'].includes(row.plan) ? row.plan : 'free';
      // A grant with an end date lapses back to Member automatically.
      if (plan !== 'free' && row.plan_expires_at && new Date(row.plan_expires_at) < new Date()) plan = 'free';
    }
  } catch {}
  const level = isAdmin ? 'admin' : plan;
  const hasAI = level !== 'free';

  let body;
  try { body = await req.json(); } catch { return _err(400, 'BAD_JSON'); }
  // 'chat' = the Ask AI assistant: same deep routing as analysis, bigger context.
  const isChat = body.purpose === 'chat';
  const purpose = (body.purpose === 'analysis' || isChat) ? 'analysis' : 'pick';

  if (!hasAI && FREE_MONTHLY_CALLS <= 0) {
    return _err(403, 'NO_AI_ACCESS',
      'Claude AI is invite-only on Warr.GG — the free Draft Brain still works. Ask Warr for AI access.',
      { level: LEVEL_LABEL[level] });
  }

  // ── BUDGET + PER-USER GUARDS (fail-open if the blob store hiccups) ──
  const day = new Date().toISOString().slice(0, 10), month = day.slice(0, 7);
  let store = null, spentUSD = 0, userCalls = 0, opusCalls = 0, userUSD = 0;
  const monthKey = 'usd:' + month;
  const userKey = hasAI ? `calls:${day}:${userId}` : `fcalls:${month}:${userId}`;
  const opusKey = `opus:${day}:${userId}`;
  const userUsdKey = `uusd:${month}:${userId}`;
  try {
    store = getStore('warr-api-usage');
    [spentUSD, userCalls, opusCalls, userUSD] = await Promise.all([
      _readNum(store, monthKey), _readNum(store, userKey), _readNum(store, opusKey), _readNum(store, userUsdKey),
    ]);
  } catch { store = null; }
  if (store) {
    if (spentUSD >= BUDGET_USD) {
      return _err(429, 'BUDGET_EXCEEDED', 'Monthly AI budget reached — the local Draft Brain takes over until next month.');
    }
    if (level === 'free' && userCalls >= FREE_MONTHLY_CALLS) {
      return _err(429, 'FREE_PLAN_CAP', "You've used this month's free AI trial — the local Draft Brain still works unlimited. Ask Warr for AI access.");
    }
    const dailyCap = level === 'team' ? TEAM_DAILY_CALLS : ANALYST_DAILY_CALLS;
    if ((level === 'pro' || level === 'team') && userCalls >= dailyCap) {
      return _err(429, 'USER_DAILY_CAP', `Daily AI limit reached for this account (${dailyCap}/day) — back tomorrow.`);
    }
  }

  // ── MODEL ROUTING ──
  const opusAllowed = level === 'admin' || (level === 'team' && (!store || opusCalls < OPUS_DAILY_CALLS));
  const deep = purpose === 'analysis' && opusAllowed;
  const model = deep ? MODEL_DEEP : MODEL_FAST;
  const effort = purpose === 'analysis' ? EFFORT_ANALYSIS : EFFORT_PICK;
  // Client max_tokens is the size of the ANSWER; thinking needs room on top.
  const answerMax = Math.min(Math.max(1, Number(body.max_tokens) || 300), 3000);
  const headroom = purpose === 'analysis' ? 6000 : 1500;

  // Chat = Heimerdinger. It can run a short tool loop (the tools execute in the
  // browser over data the user can already see), so its history may carry
  // tool_use / tool_result blocks — keep enough turns for a loop, and never
  // start on an orphaned tool_result.
  const messages = Array.isArray(body.messages) ? body.messages.slice(isChat ? -30 : 0, isChat ? undefined : 12) : [];
  const hasBlock = (m, type) => !!m && Array.isArray(m.content) && m.content.some(b => b && b.type === type);
  while (messages.length && (!messages[0] || messages[0].role !== 'user' || hasBlock(messages[0], 'tool_result'))) messages.shift();   // API needs a plain user turn first
  if (!messages.length) return _err(400, 'NO_MESSAGES');
  if (JSON.stringify(messages).length > 300000) return _err(413, 'TOO_LARGE', 'That conversation is too long — start a new chat.');
  const last = messages[messages.length - 1];
  const isStep = isChat && last.role === 'user' && hasBlock(last, 'tool_result');   // a tool-loop continuation, not a new question

  const base = { messages };
  if (body.system && typeof body.system === 'string') {
    const sys = body.system.slice(0, isChat ? 60000 : 20000);
    // Chat re-sends the same big data pack on every tool step → cache it.
    base.system = isChat ? [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }] : sys;
  }
  const tools = [];
  // Heimer's data tools (custom, client-executed): chat only, well-formed only.
  if (isChat && Array.isArray(body.tools)) {
    body.tools.filter(t => t && !t.type && typeof t.name === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(t.name) && t.input_schema && typeof t.input_schema === 'object')
      .slice(0, 12).forEach(t => tools.push({ name: t.name, description: String(t.description || '').slice(0, 1500), input_schema: t.input_schema }));
    if (JSON.stringify(tools).length > 24000) return _err(400, 'TOOLS_TOO_LARGE');
  }
  // Web search: admin only (it costs $10 per 1,000 searches).
  if (isAdmin && Array.isArray(body.tools)) {
    const ws = body.tools.filter(t => t && typeof t.type === 'string' && t.type.startsWith('web_search'));
    if (ws.length) tools.push({ ...ws[0], max_uses: Math.min(Number(ws[0].max_uses) || 3, 5) });
  }
  if (tools.length) {
    base.tools = tools;
    const tc = body.tool_choice && body.tool_choice.type;
    if (tc === 'auto' || tc === 'none') base.tool_choice = { type: tc };
  }
  if (isChat) base.messages = _cacheTail(messages);

  // Thinking blocks must go back unchanged to the SAME model. If this step runs
  // on a different model than the last one (Opus cap hit, fallback), or the
  // last tool turn had no thinking block, drop them and run this step plainly.
  const prevModel = typeof body.prev_model === 'string' ? body.prev_model : '';
  const lastAsst = [...messages].reverse().find(m => m && m.role === 'assistant');
  const build = (mdl, eff, maxTok) => {
    const noThink = !hasBlock(lastAsst, 'thinking') && !hasBlock(lastAsst, 'redacted_thinking');
    const plain = isStep && (noThink || (prevModel && prevModel !== mdl));
    if (plain) return { ...base, messages: _stripThinking(base.messages), model: mdl, max_tokens: maxTok };
    return { ...base, model: mdl, max_tokens: maxTok, thinking: { type: 'adaptive' }, output_config: { effort: eff } };
  };

  const primary = build(model, effort, answerMax + headroom);

  let { status, text, usedModel } = await _call(apiKey, primary, left(deep ? DEEP_TIMEOUT_MS : FAST_TIMEOUT_MS));
  let fellBack = '';
  // Opus too slow / rejected → one quick Sonnet retry so the user still gets an answer.
  if (deep && (status === 0 || status >= 400)) {
    fellBack = status === 0 ? 'deep-timeout' : 'deep-' + status;
    ({ status, text, usedModel } = await _call(apiKey, build(MODEL_FAST, 'low', answerMax + 1500), left(FAST_TIMEOUT_MS)));
  }
  // New-model params rejected (400/404) → retry once on the proven older model, plain request.
  if (status === 400 || status === 404) {
    fellBack = (fellBack ? fellBack + ',' : '') + 'safe-' + status;
    ({ status, text, usedModel } = await _call(apiKey, { ...base, messages: _stripThinking(base.messages), model: MODEL_SAFE, max_tokens: Math.min(answerMax, 1200) }, left(FAST_TIMEOUT_MS)));
  }
  if (status === 0) return _err(504, 'AI_TIMEOUT', 'The AI took too long — the local Draft Brain answered instead.');

  // ── METER the actual spend from Anthropic's usage block ──
  if (store && status >= 200 && status < 300) {
    try {
      const usage = JSON.parse(text)?.usage || {};
      const [pin, pout] = PRICES[usedModel] || PRICES[MODEL_FAST] || [4, 20];
      const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
      const searches = usage.server_tool_use?.web_search_requests || 0;
      const cost = (inTok * pin + (usage.output_tokens || 0) * pout) / 1e6 + searches * WEB_SEARCH_USD;
      // A tool-loop step is part of one question: it counts as a quarter call.
      const unit = isStep ? 0.25 : 1;
      const writes = [
        store.set(monthKey, String(spentUSD + cost)),
        store.set(userKey, String(userCalls + unit)),
        store.set(userUsdKey, String(userUSD + cost)),
      ];
      if (usedModel === MODEL_DEEP) writes.push(store.set(opusKey, String(opusCalls + unit)));
      await Promise.all(writes);
    } catch { /* metering failure must never break the response */ }
  }
  // Tell the client which model actually answered (a tool loop sends it back as prev_model).
  if (status >= 200 && status < 300) { try { const j = JSON.parse(text); j.warr_model = usedModel; text = JSON.stringify(j); } catch {} }
  return new Response(text, {
    status,
    headers: {
      'content-type': 'application/json',
      'x-warr-model': usedModel,
      'x-warr-level': LEVEL_LABEL[level],
      ...(fellBack ? { 'x-warr-fallback': fellBack } : {}),
      ...(_cors()),
    },
  });
};

// Thinking blocks are model-specific — strip them when a step changes model.
function _stripThinking(msgs) {
  return msgs.map(m => (m && Array.isArray(m.content) && m.content.some(b => b && (b.type === 'thinking' || b.type === 'redacted_thinking')))
    ? { ...m, content: m.content.filter(b => b && b.type !== 'thinking' && b.type !== 'redacted_thinking') } : m);
}
// Cache breakpoint on the newest turn, so each tool step re-reads the
// conversation so far from cache instead of paying for it again.
function _cacheTail(msgs) {
  if (!msgs.length) return msgs;
  const out = msgs.slice(), m = out[out.length - 1];
  if (typeof m.content === 'string') out[out.length - 1] = { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] };
  else if (Array.isArray(m.content) && m.content.length) {
    const c = m.content.slice(), b = c[c.length - 1];
    if (b && (b.type === 'text' || b.type === 'tool_result')) c[c.length - 1] = { ...b, cache_control: { type: 'ephemeral' } };
    out[out.length - 1] = { ...m, content: c };
  }
  return out;
}

// One Anthropic call with a hard timeout. status 0 = timed out / network error.
async function _call(apiKey, payload, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    return { status: r.status, text: await r.text(), usedModel: payload.model };
  } catch {
    return { status: 0, text: '', usedModel: payload.model };
  } finally {
    clearTimeout(t);
  }
}

function _cors() {
  // Same-origin in production; explicit headers keep local file:// testing sane.
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization, x-supabase-anon',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

export const config = { path: '/api/claude' };
