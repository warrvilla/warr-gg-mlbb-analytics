// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — Heimerdinger: the side-panel MLBB analyst chat
//
// Loaded by warr-nav.js on every page once a user is signed in. A small
// launcher sits bottom-right; clicking it slides a chat panel in from the
// right. Questions are answered by Claude (via /api/claude, purpose 'chat')
// from a DATA PACK built here in the browser:
//   • teams/heroes mentioned in the question (or on the current page)
//   • each team's current-season profile from WIntel (ban impact, heroes
//     that beat them, tempo, lanes/players, recent drafts)
//   • matchup model + head-to-head, league meta and standings
//   • draft order (first/last picks, phase 1/2 bans, series adjustments)
// …and Heimer can query everything else himself: warr-heimer-tools.js gives
// Claude tools (query_games, team_report, draft_tendencies, matchup,
// hero_report, player_report, league_report, list_data) that run HERE over
// the same data, in a short loop (ask → tool calls → answer).
// Privacy: the data comes from WDB.loadMatches(), which the database already
// limits (RLS) to official leagues + the user's own / shared scrims. Another
// team's scrims never reach this browser, so they can't reach the model.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  if (window.__heimer) return;
  window.__heimer = true;

  const HD = { ready: false, loading: null, matches: [], usable: [], teams: [], heroes: [], cur: {}, myTeam: '', chat: [], ctxTeams: [], busy: false };
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => Math.round(v * 100);
  const user = () => { try { return WAuth.getUser(); } catch (_) { return null; } };
  const KEY = () => 'warr_heimer_chat_' + (user()?.id || 'anon');
  const TEAMKEY = 'warr_heimer_team';
  const hasAI = () => { try { return WDB.hasAIAccess(); } catch (_) { return false; } };
  const deep = () => { try { return WDB._isAdminUser() || WDB.getSubscription().plan === 'team'; } catch (_) { return false; } };
  // Heimer's mascot — an original little analyst bot (purple head, screen face,
  // glowing antenna). It blinks when idle and scans side to side while thinking.
  let _botN = 0;
  function bot(size, cls) {
    const id = 'hdb' + (++_botN);
    return `<svg class="hd-bot ${cls || ''}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
      <defs>
        <linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A48CFF"/><stop offset="1" stop-color="#6447DC"/></linearGradient>
        <radialGradient id="${id}o" cx=".4" cy=".35"><stop offset="0" stop-color="#FFF8D6"/><stop offset="1" stop-color="#FFBE4D"/></radialGradient>
      </defs>
      <line x1="32" y1="15" x2="32" y2="8" stroke="#C3B2FF" stroke-width="2.6" stroke-linecap="round"/>
      <circle class="hd-orb" cx="32" cy="6.5" r="3.8" fill="url(#${id}o)"/>
      <rect x="6.5" y="28" width="6.5" height="13" rx="3.25" fill="#5338C4"/>
      <rect x="51" y="28" width="6.5" height="13" rx="3.25" fill="#5338C4"/>
      <rect x="10.5" y="14.5" width="43" height="39" rx="16" fill="url(#${id}h)"/>
      <path d="M17 18.5 q15 -4 30 0" stroke="#fff" stroke-opacity=".28" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <rect x="15.5" y="22" width="33" height="23" rx="10.5" fill="#150F28"/>
      <g class="hd-eyes">
        <ellipse cx="25.5" cy="32" rx="3.6" ry="4.4" fill="#7DF6D4"/><ellipse cx="38.5" cy="32" rx="3.6" ry="4.4" fill="#7DF6D4"/>
        <circle cx="26.8" cy="30.3" r="1.2" fill="#fff"/><circle cx="39.8" cy="30.3" r="1.2" fill="#fff"/>
      </g>
      <path d="M29 38.6 q3 2.3 6 0" stroke="#7DF6D4" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <ellipse cx="20" cy="39.5" rx="2.5" ry="1.5" fill="#FF8DB4" opacity=".8"/>
      <ellipse cx="44" cy="39.5" rx="2.5" ry="1.5" fill="#FF8DB4" opacity=".8"/>
    </svg>`;
  }

  // ── Styles ──────────────────────────────────────────────────────────────
  const CSS = `
  .hd-launch{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0.5px solid rgba(167,139,250,.45);background:radial-gradient(circle at 50% 35%,#2d2350,#141022 70%);display:grid;place-items:center;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);transition:transform .2s cubic-bezier(.34,1.56,.64,1),box-shadow .18s ease;padding:0;}
  .hd-launch:hover{transform:translateY(-3px) rotate(-6deg);box-shadow:0 12px 32px rgba(0,0,0,.6),0 0 0 4px rgba(124,92,246,.16);}
  .hd-launch .hd-bot{margin-top:2px;}
  .hd-bot .hd-eyes{transform-box:fill-box;transform-origin:center;animation:hdBlink 4.5s infinite;}
  .hd-bot .hd-orb{animation:hdGlow 2.4s ease-in-out infinite;}
  .hd-bot.thinking .hd-eyes{animation:hdScan 1.1s ease-in-out infinite;}
  .hd-bot.thinking .hd-orb{animation:hdGlow .6s ease-in-out infinite;}
  @keyframes hdBlink{0%,91%,100%{transform:scaleY(1);}94%{transform:scaleY(.12);}}
  @keyframes hdScan{0%,100%{transform:translateX(-2.4px);}50%{transform:translateX(2.4px);}}
  @keyframes hdGlow{0%,100%{opacity:.75;}50%{opacity:1;filter:drop-shadow(0 0 3px #FFD36E);}}
  @media (prefers-reduced-motion: reduce){.hd-bot .hd-eyes,.hd-bot .hd-orb{animation:none !important;}}
  .hd-launch .tip{position:absolute;right:58px;white-space:nowrap;font:600 12px/1 -apple-system,'SF Pro Text','Inter',sans-serif;color:#F0F0F8;background:rgba(16,16,26,.92);border:0.5px solid rgba(255,255,255,.1);padding:7px 10px;border-radius:9999px;opacity:0;transform:translateX(6px);transition:all .18s ease;pointer-events:none;}
  .hd-launch:hover .tip{opacity:1;transform:none;}
  .hd-launch.open{opacity:0;pointer-events:none;}
  .hd-panel{position:fixed;top:64px;right:14px;bottom:14px;z-index:2147483001;width:400px;max-width:calc(100vw - 28px);display:flex;flex-direction:column;border-radius:20px;background:rgba(13,13,21,.97);backdrop-filter:blur(24px) saturate(140%);-webkit-backdrop-filter:blur(24px) saturate(140%);border:0.5px solid rgba(255,255,255,.09);box-shadow:0 24px 64px rgba(0,0,0,.65);color:#F0F0F8;font-family:-apple-system,'SF Pro Text','Inter',sans-serif;transform:translateX(24px);opacity:0;pointer-events:none;transition:transform .26s cubic-bezier(.22,1,.36,1),opacity .2s ease;}
  .hd-panel.open{transform:none;opacity:1;pointer-events:auto;}
  .hd-panel.min{top:auto;height:auto;width:300px;border-radius:16px;cursor:pointer;}
  .hd-panel.min > :not(.hd-ph){display:none !important;}
  .hd-panel.min .hd-ph{border-bottom:none;padding:9px 10px 9px 12px;}
  .hd-panel.min .hd-mark{width:30px;height:30px;}
  .hd-panel.min #hdNew{display:none;}
  .hd-panel.min #hdMin{margin-left:auto;}
  .hd-panel.min .hd-dot{margin-left:4px;}
  .hd-dot{display:none;width:8px;height:8px;border-radius:50%;background:#34C759;box-shadow:0 0 0 3px rgba(52,199,89,.22);flex-shrink:0;}
  .hd-panel.min.unread .hd-dot{display:inline-block;}
  .hd-ph{display:flex;align-items:center;gap:10px;padding:12px 12px 10px 14px;border-bottom:0.5px solid rgba(255,255,255,.07);}
  .hd-mark{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:radial-gradient(circle at 50% 35%,#2d2350,#141022 75%);border:0.5px solid rgba(167,139,250,.35);flex-shrink:0;}
  .hd-ttl{display:flex;flex-direction:column;min-width:0;}
  .hd-ttl b{font-size:14px;font-weight:700;letter-spacing:-.01em;}
  .hd-ttl span{font-size:11px;color:rgba(240,240,248,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .hd-ib{margin-left:auto;width:30px;height:30px;border-radius:9px;border:none;background:transparent;color:rgba(240,240,248,.6);cursor:pointer;display:grid;place-items:center;font-size:15px;}
  .hd-ib + .hd-ib{margin-left:2px;}
  .hd-ib:hover{background:rgba(255,255,255,.07);color:#F0F0F8;}
  .hd-ctx{display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:11.5px;color:rgba(240,240,248,.45);border-bottom:0.5px solid rgba(255,255,255,.06);flex-wrap:wrap;}
  .hd-pick{display:inline-flex;align-items:center;gap:7px;max-width:220px;padding:4px 10px 4px 5px;border-radius:9999px;border:0.5px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#F0F0F8;font:inherit;font-size:12px;font-weight:600;cursor:pointer;}
  .hd-pick:hover{background:rgba(255,255,255,.09);}
  .hd-pick .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .hd-pick .car{opacity:.55;font-size:10px;}
  .hd-lg{width:20px;height:20px;border-radius:6px;flex-shrink:0;position:relative;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;}
  .hd-lg img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}
  .hd-lg i{font-style:normal;display:none;} .hd-lg.noimg{background:var(--mc,#5E5CE6);} .hd-lg.noimg img{display:none;} .hd-lg.noimg i{display:inline;}
  .hd-pop{position:absolute;left:10px;right:10px;top:104px;z-index:5;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:16px;background:#14121f;border:0.5px solid rgba(255,255,255,.12);box-shadow:0 18px 48px rgba(0,0,0,.6);max-height:min(460px,calc(100% - 120px));}
  .hd-pop[hidden]{display:none;}
  .hd-pop .row{display:flex;gap:5px;flex-wrap:wrap;align-items:center;}
  .hd-pop .k{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(240,240,248,.4);width:46px;}
  .hd-chip{padding:4px 10px;border-radius:9999px;font-size:11.5px;border:0.5px solid rgba(255,255,255,.1);background:transparent;color:rgba(240,240,248,.75);cursor:pointer;font-family:inherit;}
  .hd-chip:hover{background:rgba(255,255,255,.06);color:#fff;}
  .hd-chip.on{background:rgba(124,92,246,.2);border-color:rgba(124,92,246,.45);color:#fff;}
  .hd-chip .cur{font-size:9px;color:#34D399;margin-left:4px;font-weight:600;}
  .hd-pop input{background:rgba(255,255,255,.05);color:#F0F0F8;border:0.5px solid rgba(255,255,255,.1);border-radius:10px;padding:7px 10px;font:inherit;font-size:12px;outline:none;}
  .hd-pop input:focus{border-color:rgba(124,92,246,.45);}
  .hd-plist{overflow-y:auto;display:flex;flex-direction:column;gap:2px;min-height:60px;scrollbar-width:thin;}
  .hd-prow{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:10px;border:none;background:transparent;color:#F0F0F8;font:inherit;font-size:12.5px;cursor:pointer;text-align:left;}
  .hd-prow:hover{background:rgba(255,255,255,.06);}
  .hd-prow.on{background:rgba(124,92,246,.18);}
  .hd-prow .rec{margin-left:auto;font-size:10.5px;color:rgba(240,240,248,.45);font-family:'JetBrains Mono',monospace;}
  .hd-pop .none{font-size:11.5px;color:rgba(240,240,248,.5);background:none;border:none;cursor:pointer;text-align:left;padding:2px 0;font-family:inherit;}
  .hd-pop .none:hover{color:#fff;}
  .hd-panel textarea.hd-ta{box-shadow:none;}
  .hd-ctx .pg{color:#B9A6FF;}
  .hd-thread{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px;scrollbar-width:thin;}
  .hd-u{align-self:flex-end;max-width:85%;background:rgba(124,92,246,.16);border:0.5px solid rgba(124,92,246,.3);padding:8px 12px;border-radius:14px 14px 4px 14px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;}
  .hd-a{align-self:stretch;font-size:13px;line-height:1.6;color:rgba(240,240,248,.92);}
  .hd-a .who{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#B9A6FF;margin-bottom:4px;letter-spacing:.02em;}
  .hd-a .md h4{font-size:13px;margin:10px 0 4px;color:#F0F0F8;}
  .hd-a .md p{margin:0 0 7px;}
  .hd-a .md ul,.hd-a .md ol{margin:0 0 7px;padding-left:18px;}
  .hd-a .md li{margin:2px 0;}
  .hd-a .md strong{color:#fff;font-weight:650;}
  .hd-a .md code{font-family:'JetBrains Mono',monospace;font-size:11.5px;background:rgba(255,255,255,.06);padding:1px 5px;border-radius:5px;}
  .hd-a .md table{border-collapse:collapse;width:100%;margin:4px 0 8px;font-size:12px;}
  .hd-a .md th,.hd-a .md td{border-bottom:0.5px solid rgba(255,255,255,.08);padding:4px 6px;text-align:left;}
  .hd-a .md th{color:rgba(240,240,248,.55);font-weight:600;}
  .hd-a .meta{margin-top:6px;font-size:10.5px;color:rgba(240,240,248,.38);}
  .hd-a.err .md{color:#F2A6AC;}
  .hd-think{display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(240,240,248,.5);}
  .hd-dots{display:inline-flex;gap:3px;}
  .hd-dots i{width:5px;height:5px;border-radius:50%;background:#B9A6FF;opacity:.3;animation:hdb 1.2s infinite;}
  .hd-dots i:nth-child(2){animation-delay:.15s;} .hd-dots i:nth-child(3){animation-delay:.3s;}
  @keyframes hdb{0%,80%,100%{opacity:.25;transform:translateY(0);}40%{opacity:1;transform:translateY(-2px);}}
  .hd-empty{display:flex;flex-direction:column;gap:10px;margin-top:4px;}
  .hd-empty p{margin:0;font-size:12.5px;color:rgba(240,240,248,.6);line-height:1.55;}
  .hd-sug{display:block;width:100%;text-align:left;padding:9px 11px;border-radius:12px;border:0.5px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:rgba(240,240,248,.85);font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,border-color .15s;}
  .hd-sug:hover{background:rgba(255,255,255,.07);border-color:rgba(167,139,250,.35);}
  .hd-form{display:flex;align-items:flex-end;gap:8px;padding:10px 12px 6px;border-top:0.5px solid rgba(255,255,255,.07);}
  .hd-form textarea{flex:1;resize:none;max-height:120px;min-height:38px;background:rgba(255,255,255,.05);color:#F0F0F8;border:0.5px solid rgba(255,255,255,.1);border-radius:12px;padding:9px 12px;font:inherit;font-size:13px;line-height:1.4;outline:none;}
  .hd-form textarea:focus{border-color:rgba(124,92,246,.45);box-shadow:0 0 0 3px rgba(124,92,246,.12);}
  .hd-send{width:38px;height:38px;border-radius:12px;border:none;background:#7C5CF6;color:#fff;cursor:pointer;display:grid;place-items:center;flex-shrink:0;}
  .hd-send:disabled{opacity:.35;cursor:not-allowed;}
  .hd-note{padding:0 14px 10px;font-size:10px;color:rgba(240,240,248,.32);}
  .hd-gate{margin:6px 0;padding:12px;border-radius:12px;border:0.5px solid rgba(200,144,80,.3);background:rgba(200,144,80,.07);font-size:12.5px;line-height:1.55;color:rgba(240,240,248,.8);}
  .hd-gate a{color:#E0B47A;font-weight:600;}
  html[data-theme="light"] .hd-panel{background:rgba(250,250,253,.98);color:#14141c;border-color:rgba(0,0,0,.08);}
  html[data-theme="light"] .hd-a{color:#1d1d26;} html[data-theme="light"] .hd-a .md strong{color:#000;}
  html[data-theme="light"] .hd-form textarea{background:#fff;color:#14141c;border-color:rgba(0,0,0,.12);}
  html[data-theme="light"] .hd-sug{background:#fff;color:#1d1d26;border-color:rgba(0,0,0,.08);}
  @media (max-width:600px){
    .hd-panel{top:auto;left:0;right:0;bottom:0;width:auto;max-width:none;height:86vh;border-radius:18px 18px 0 0;transform:translateY(24px);}
    .hd-launch{right:14px;bottom:14px;width:46px;height:46px;}
    .hd-launch .tip{display:none;}
    .hd-panel.min{left:auto;right:14px;bottom:14px;width:auto;max-width:calc(100vw - 28px);height:auto;border-radius:16px;}
  }`;

  // ── Markdown (escape first, then a small safe subset) ───────────────────
  function md(src) {
    const lines = esc(src || '').split('\n');
    const inl = t => t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    let out = '', list = null, para = [];
    const flushP = () => { if (para.length) { out += `<p>${inl(para.join(' '))}</p>`; para = []; } };
    const flushL = () => { if (list) { out += `</${list}>`; list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], t = l.trim();
      if (!t) { flushP(); flushL(); continue; }
      if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
        flushP(); flushL();
        const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inl(c.trim()));
        out += '<table><tr>' + row(t).map(c => `<th>${c}</th>`).join('') + '</tr>';
        i += 2;
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { out += '<tr>' + row(lines[i]).map(c => `<td>${c}</td>`).join('') + '</tr>'; i++; }
        i--; out += '</table>'; continue;
      }
      const h = t.match(/^#{1,4}\s+(.*)$/);
      if (h) { flushP(); flushL(); out += `<h4>${inl(h[1])}</h4>`; continue; }
      const ul = t.match(/^[-*•]\s+(.*)$/), ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ul || ol) { flushP(); const kind = ul ? 'ul' : 'ol'; if (list !== kind) { flushL(); out += `<${kind}>`; list = kind; } out += `<li>${inl((ul || ol)[1])}</li>`; continue; }
      flushL(); para.push(t);
    }
    flushP(); flushL();
    return out;
  }

  // ── Data ────────────────────────────────────────────────────────────────
  function loadScript(src) {
    return new Promise(res => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  }
  async function ensureData() {
    if (HD.ready) return;
    if (HD.loading) return HD.loading;
    HD.loading = (async () => {
      if (!window.WIntel || !WIntel.draftOrder) await loadScript('warr-intel.js?v=6');
      if (!window.WDraft || !window.WDraft.prob) await loadScript('warr-draft-model.js?v=5');
      if (!window.WBan || !window.WBan.v2) await loadScript('warr-ban.js?v=2');
      if (!window.WHeroProfile || !window.WHeroProfile.addFromKit) await loadScript('warr-hero-profiles.js?v=2');
      if (!window.WBrain || !window.WBrain.setCalendar) await loadScript('warr-draft-brain.js?v=4');
      if (!window.WHeroData) await loadScript('warr-hero-data.js?v=2');
      if (!window.HeimerTools || !window.HeimerTools.lite || !window.HeimerTools.defs.some(d => d.name === 'patch_report')) await loadScript('warr-heimer-tools.js?v=10');
      // Hero kits + patch notes (Liquipedia, refreshed by the server every 6 h). Never blocks Heimer for long.
      try {
        const hdP = WHeroData.load({ full: true }).then(() => {
          if (WHeroData.ready()) { WHeroData.augmentProfiles(window.WHeroProfile); if (window.WBrain) WBrain.setCalendar(WHeroData.calendar()); }
        });
        await Promise.race([hdP, new Promise(r => setTimeout(r, 5000))]);
      } catch (_) {}
      let ms = [];
      try { ms = await WDB.loadMatches(); } catch (_) {}
      if (!ms || !ms.length) {   // offline / not synced yet → this browser's scout cache
        try { ms = (JSON.parse(localStorage.getItem('warr_scout_data') || '{}').matches) || []; } catch (__) {}
      }
      try { if (WDB.initLocks) await WDB.initLocks(); } catch (_) {}
      try { (await WDB.loadLeagues()).forEach(l => { if (l.current_season) HD.cur[l.name] = l.current_season; }); } catch (_) {}
      HD.matches = ms || [];
      HD.usable = HD.matches.filter(m => m && m.blueTeam && m.redTeam && (m.winner === 'blue' || m.winner === 'red') && !/ai battle|^other$/i.test(m.league || ''));
      HD.teams = [...new Set(HD.usable.flatMap(m => [m.blueTeam, m.redTeam]))].sort((a, b) => a.localeCompare(b));
      HD.heroes = (WDB.HERO_ROSTER || []).map(h => h.n).filter(Boolean);
      HD.ready = true;
    })();
    return HD.loading;
  }
  const locked = t => { try { return WDB.isTeamLocked && WDB.isTeamLocked(t) && !WDB.canViewTeam(t); } catch (_) { return false; } };
  const isScrim = m => (m.league || '') === 'Scrims';
  const involves = (m, t) => m.blueTeam === t || m.redTeam === t;
  const byDateDesc = (a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0);
  function leagueOf(team) {
    const g = HD.usable.filter(m => involves(m, team)).sort(byDateDesc);
    return (g.find(m => !isScrim(m)) || g[0] || {}).league || '';
  }
  function seasonsOf(lg) {
    return [...new Set(HD.usable.filter(m => m.league === lg).map(m => (m.season || '').trim()).filter(Boolean))]
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }
  function scopeOf(team, lgOverride) {
    const lg = lgOverride || leagueOf(team);
    const ss = seasonsOf(lg);
    const ov = HD.seOverride && HD.seOverride.league === lg ? HD.seOverride.season : null;
    const cur = ov !== null && (ov === '' || ss.includes(ov)) ? ov : (HD.cur[lg] && ss.includes(HD.cur[lg]) ? HD.cur[lg] : ss[0]);
    const seasons = cur ? [cur] : [];
    const inS = m => m.league === lg && (!seasons.length || seasons.includes((m.season || '').trim()));
    const n = () => HD.usable.filter(m => inS(m) && (!team || involves(m, team))).length;
    const prev = ss[ss.indexOf(cur) + 1];
    if (team && n() < 8 && prev) seasons.push(prev);
    const pool = HD.usable.filter(inS);
    return { league: lg, seasons, label: `${lg}${seasons.length ? ' ' + seasons.join(' + ') : ''}`, pool };
  }
  // What's on screen: the Analysis matchup (blue = the user's side) or the
  // team AI Battle is emulating.
  function pageCtx() {
    let blue = '', red = '';
    try { if (typeof _mp !== 'undefined' && _mp) { blue = _mp.blue || ''; red = _mp.red || ''; } } catch (_) {}
    try { if (!red && typeof enemyProfile !== 'undefined' && enemyProfile && enemyProfile.name) red = enemyProfile.name; } catch (_) {}
    const ok = t => t && HD.teams.includes(t) && !locked(t);
    return { blue: ok(blue) ? blue : '', red: ok(red) ? red : '' };
  }
  function pageTeams() { const c = pageCtx(); return [c.blue, c.red].filter(Boolean); }

  // ── The data pack the model must answer from ────────────────────────────
  function buildPack(q) {
    const myLg = HD.myTeam ? leagueOf(HD.myTeam) : '';
    const prefer = t => (t === HD.myTeam ? 3 : 0) + (myLg && leagueOf(t) === myLg ? 1 : 0);
    const visible = HD.teams.filter(t => !locked(t));
    let teams = WIntel.findTeams(q, visible, prefer);
    const privateAsked = WIntel.findTeams(q, HD.teams.filter(locked));
    if (/\b(we|us|our|ours|my team|kami|namin|natin)\b/i.test(q) && HD.myTeam && !teams.includes(HD.myTeam)) teams.unshift(HD.myTeam);
    if (!teams.length && HD.ctxTeams.length) teams = HD.ctxTeams.slice();              // follow-up question
    if (!teams.length) teams = pageTeams().filter(t => !locked(t));                    // whatever's on screen
    teams = teams.slice(0, 3);
    const heroes = WIntel.findHeroes(q, HD.heroes);
    // Stage the question is about: playoffs vs regular season (else: whole season, split shown).
    const stageQ = /\b(play-?offs?|knock-?outs?|brackets?|upper bracket|lower bracket|elimination|grand ?finals?|finals?|semi-?finals?|semis|quarter-?finals?)\b/i.test(q) ? 'Playoffs'
      : /\b(regular season|reg(?:ular)?\.? season|group stage|groups|swiss|week \d+|weeks)\b/i.test(q) ? 'Regular Season' : '';
    const parts = [], used = [];
    const today = new Date().toISOString().slice(0, 10);
    const u = user();
    parts.push(`TODAY: ${today}. USER: ${(u && (u.user_metadata?.name || u.email || '').split('@')[0]) || 'coach'}. USER'S TEAM: ${HD.myTeam || 'not set'}.`);
    const scopes = {};
    const splitTxt = sp => Object.entries(sp).filter(([k]) => k !== 'Scrims').map(([k, x]) => `${k}: games ${x.gw}-${x.gl}, series ${x.sw}-${x.sl}${x.sd ? ` (${x.sd} unfinished/drawn)` : ''}`).join(' | ');
    teams.forEach(t => {
      const sc = scopeOf(t); scopes[t] = sc;
      const R = WIntel.ratings(sc.pool);
      // Profile on the stage asked about (if the team has games there), else the season.
      const stPool = stageQ ? sc.pool.filter(m => WIntel.stageGroup(m) === stageQ) : sc.pool;
      const stN = stPool.filter(m => involves(m, t)).length;
      const usePool = stageQ && stN >= 2 ? stPool : sc.pool;
      const scopeLbl = `${sc.label}${stageQ && stN >= 2 ? ' · ' + stageQ + ' only' : ' · all stages'}`;
      const I = WIntel.team(usePool, t, R);
      const lv = WIntel.levers(I);
      used.push(`${t} (${scopeLbl}, ${I.n}g)`);
      const lanes = WIntel.LANES.filter(l => I.lanes[l]).map(l => `${l}: ${I.lanes[l].main || '?'} (${I.lanes[l].top.map(x => x.hero).join(', ')})`).join(' | ');
      const scr = HD.usable.filter(m => isScrim(m) && involves(m, t));
      const series = WIntel.series(sc.pool, t).slice(0, 10).map(x => `${(x.date || '').slice(0, 10)} ${x.stageRaw || x.stage}${x.week ? ' · ' + x.week : ''}${x.format ? ' · ' + x.format : ''}: ${x.result === 'W' ? 'WON' : x.result === 'L' ? 'LOST' : 'unfinished/drawn'} ${x.w}-${x.l} vs ${x.opp}`);
      parts.push([
        `=== TEAM: ${t} — ${scopeLbl}, ${I.n} official games ===`,
        `Record by stage (${sc.label}): ${splitTxt(WIntel.stageSplit(sc.pool, t)) || 'n/a'}`,
        stageQ && stN < 2 ? `NOTE: only ${stN} ${stageQ.toLowerCase()} game(s) for ${t} in ${sc.label} — the profile below uses the whole season.` : '',
        series.length ? `Series results (newest first):\n${series.join('\n')}` : '',
        WIntel.promptBlock(I, lv),
        lanes ? `Players by lane (main player, most-played heroes): ${lanes}` : '',
        WIntel.edges(I).length ? `Strengths: ${WIntel.edges(I).join('; ')}` : '',
        WIntel.draftOrder ? WIntel.draftOrderBlock(WIntel.draftOrder(usePool, t)) : '',
        `Recent official games (newest first, with stage):\n${WIntel.recentGames(usePool, t, 8).join('\n') || 'none'}`,
        scr.length ? `USER'S OWN SCRIMS involving ${t} (private to the user, ${scr.length} games):\n${WIntel.recentGames(scr, t, 6).join('\n')}` : '',
      ].filter(Boolean).join('\n'));
    });
    if (teams.length >= 2) {
      const [a, b] = teams, sc = scopes[a];
      const R = WIntel.ratings(sc.pool);
      const same = R.games[a] && R.games[b];
      const h2h = HD.usable.filter(m => involves(m, a) && involves(m, b) && !isScrim(m)).sort(byDateDesc);
      const aw = h2h.filter(m => (m.blueTeam === a && m.winner === 'blue') || (m.redTeam === a && m.winner === 'red')).length;
      parts.push([
        `=== MATCHUP: ${a} vs ${b} ===`,
        same ? `Opponent-adjusted model (${sc.label}): ${a} ${pct(R.pGame(a, b))}% per game, BO3 ${pct(R.pSeries(a, b, 3))}%, BO5 ${pct(R.pSeries(a, b, 5))}%. Strength rank: ${a} #${R.rank(a)}, ${b} #${R.rank(b)} of ${R.teams}.` : `Different leagues/seasons — no shared model.`,
        `Head-to-head (official, all seasons): ${a} ${aw}-${h2h.length - aw} in ${h2h.length} games; series: ${(() => { const ss = WIntel.series(h2h, a); return `${ss.filter(x => x.result === 'W').length}-${ss.filter(x => x.result === 'L').length}` + (ss.length ? ` (${ss.slice(0, 5).map(x => `${(x.date || '').slice(0, 10)} ${x.stageRaw || x.stage} ${x.w}-${x.l}`).join('; ')})` : ''); })()}.`,
        h2h.length ? `Last H2H games:\n${WIntel.recentGames(h2h, a, 5).join('\n')}` : '',
      ].filter(Boolean).join('\n'));
    }
    // League context: meta + standings (first team's league, else the user's, else the most active)
    let lg = teams[0] ? scopes[teams[0]].league : (myLg || '');
    if (!lg) { const c = {}; HD.usable.filter(m => !isScrim(m)).forEach(m => { c[m.league] = (c[m.league] || 0) + 1; }); lg = Object.keys(c).sort((x, y) => c[y] - c[x])[0] || ''; }
    if (lg) {
      const sc = scopeOf('', lg);
      const R = WIntel.ratings(sc.pool);
      const rec = {}; sc.pool.forEach(m => [['blue', m.blueTeam], ['red', m.redTeam]].forEach(([s, t]) => { const x = rec[t] || (rec[t] = { w: 0, l: 0 }); if (m.winner === s) x.w++; else x.l++; }));
      const strength = Object.keys(rec).sort((x, y) => (R.r[y] || 0) - (R.r[x] || 0)).slice(0, 12).map((t, i) => `${i + 1}. ${t}`).join(' | ');
      const table = WIntel.standings(sc.pool).map((r, i) => `${i + 1}. ${r.team} ${r.sw}-${r.sl} (games ${r.gw}-${r.gl}, ${r.gw - r.gl >= 0 ? '+' : ''}${r.gw - r.gl})`).join(' | ');
      const po = WIntel.playoffSeries(sc.pool).map(x => `${(x.date || '').slice(0, 10)} ${x.stage}${x.week ? ' · ' + x.week : ''}${x.format ? ' (' + x.format + ')' : ''}: ${x.a} ${x.aw}-${x.bw} ${x.b}`);
      const latest = sc.pool.slice().sort(byDateDesc)[0];
      const meta = WIntel.meta(stageQ ? sc.pool.filter(m => WIntel.stageGroup(m) === stageQ) : sc.pool).slice(0, 16).map(m => `${m.hero} ${pct(m.pres)}% pres (${m.picks}p/${m.bans}b${m.picks >= 4 ? `, ${pct(m.adjWR)}% WR` : ''})`).join(', ');
      parts.push([
        `=== LEAGUE: ${sc.label} (${sc.pool.length} games) ===`,
        latest ? `Latest stage played: ${latest.stage || WIntel.stageGroup(latest)}${latest.week ? ' · ' + latest.week : ''} (${(latest.date || '').slice(0, 10)}).` : '',
        table ? `REGULAR SEASON STANDINGS (series W-L, then game difference): ${table}` : 'No regular-season games logged.',
        po.length ? `PLAYOFF SERIES (oldest first):\n${po.join('\n')}` : 'No playoff games logged yet.',
        `Opponent-adjusted strength ranking (all stages, NOT the standings): ${strength}`,
        `Meta${stageQ ? ' (' + stageQ + ' only)' : ''} (presence = picked or banned per game): ${meta}`,
      ].filter(Boolean).join('\n'));
      if (!teams.length) used.push(`${sc.label} (${sc.pool.length}g)`);
      heroes.forEach(h => {
        const x = WIntel.hero(sc.pool, h);
        parts.push(`=== HERO: ${h} in ${sc.label} ===\n${x.picks} picks, ${x.bans} bans in ${x.games} games (${pct(x.pres)}% presence)${x.wr != null ? `, ${pct(x.wr)}% WR` : ''}. Lanes: ${x.lanes.join(', ') || '—'}. Teams: ${x.teams.join(', ') || '—'}. Best into: ${x.bestInto.join(', ') || '—'}. Struggles into: ${x.worstInto.join(', ') || '—'}.`);
      });
      if (heroes.length && !teams.length) used.push(heroes.join(', '));
    }
    if (privateAsked.length) parts.push(`PRIVATE TEAMS the user asked about (data locked — say you can't see it): ${privateAsked.join(', ')}`);
    // Pages can tell Heimer what's on screen (e.g. AI Battle's live draft).
    try { const pc = typeof window.heimerContext === 'function' ? window.heimerContext() : null; if (pc && pc.text) parts.unshift(`=== ON SCREEN NOW ===\n${pc.text}`); } catch (_) {}
    let text = parts.join('\n\n');
    if (text.length > 55000) text = text.slice(0, 55000) + '\n…(trimmed)';
    return { text, teams, used };
  }

  function systemPrompt(pack) {
    return `You are Heimerdinger, the MLBB (Mobile Legends: Bang Bang) analyst built into Warr.GG, talking to a coach or analyst.

RULES
- Every stat you state must come from the DATA PACK, with its game count (e.g. "Chou 8-0 in 8 games"). Never invent stats, results, players or patch notes.
- If the data doesn't cover the question, say so in one line, then help from general MLBB knowledge and label it as general knowledge.
- Under ~5 games is an early signal — say so. Prefer the current season.
- Stages matter: regular season and playoffs are different contexts. "Standings" = the regular-season table (series record, then game difference) — not the strength ranking. Playoffs are knockout series (BO5/BO7). Always say which stage a number is from, and whether it's a game record or a series record. If asked about playoffs, use playoff data first and note when the sample is small.
- Privacy: you only see official matches plus the user's own scrims. You cannot see other teams' scrims. If asked, say that plainly.
- Answer like a sharp coach: the answer first in 1–2 sentences, then the evidence as bullets, then a concrete plan (bans, picks, win condition, timings) when it fits.
- Keep it tight — about 200 words unless they ask for depth. Markdown: short headings, bullets, **bold** hero/team names. Small tables are fine.
- Reply in the user's language (English, Filipino or Taglish).

TOOLS
- The DATA PACK below is only a starting summary. Your tools query ALL of Warr.GG's data: every league, season, stage, team, player, hero and patch; full drafts in pick order; draft tendencies; head-to-heads; standings; admin coach notes and rosters; curated counters/synergies; solo-queue Top 100; every hero's kit and the recent patch notes (Liquipedia, refreshed automatically).
- Use a tool whenever the pack doesn't answer directly, the question is specific (a stage, side, game number, patch, player, hero pairing, "what do they do when X is banned"), or before you recommend bans/picks — check it. Don't fetch what the pack already shows.
- Ask for several things in one turn (parallel tool calls). One or two rounds is usually enough.
- A tool ERROR saying a team is private means: tell the user you can't see that team's data.
- evaluate_draft rates a draft (full or partial) with the trained draft model and suggests next picks; predict_draft replicates how a named team drafts (their likely next pick/ban and why). Use them for "is this draft good", "what should we pick/ban now", "what will they pick". The model reports its own back-test — if it says the draft terms add little, present its numbers as hints and lean on game sense.
- If ON SCREEN NOW shows a live draft, questions like "what should I pick?" are about that draft: pass its picks/bans to the draft tools.
- TEAM THINKING: for "how does X draft / think / what's their style", call team_brain — it is learned from every pick and ban the team made against the options that were open, compared with the league. For "why did they pick/ban that" in a real game, call explain_game. Explain the reasons in coach language (power picks, comfort, counters, synergy, comp fixes, denies, flex, lane plans, habits, pocket picks; meta / target / protect / role / lane-lock bans) and quote the engine-check accuracy when you rely on predictions.
- PATCH & KITS: for "who is strongest / OP this patch", "what got buffed or nerfed", tier lists, or what a hero's skills do (CC, cooldowns, damage numbers), call patch_report (optionally with a hero or lane). It combines the patch notes (exact old → new numbers from Liquipedia), pro picks/bans/wins on this patch vs the last, the draft model and solo-queue Top 100, and says how many games back it. Quote skill numbers and patch changes ONLY from patch_report — never from memory. Credit "Liquipedia" when you quote kit or patch-note numbers. If a tool says data isn't available, repeat its reason as given — never claim an outside site (Liquipedia, etc.) is down.
- BANS: for any ban question call ban_plan (opponent, the user's team, the user's side if known, the draft so far, the map, and earlier games of this series if the user mentions them). A real ban plan mixes meta/OP bans (what pros ban this season, rising heroes, tier lists) with opponent-specific ones (comfort, ban impact, first picks, a one-trick lane pool) and threats to the user's comp — never recommend bans from one team's stats alone. The "Ban …" lines in the DATA PACK levers are team-only evidence, not a ban plan. Present bans phase by phase with the reason for each.

DRAFT THINKING
- Think like a draft coach: first-pick priority and denial, flex picks that hide lanes, what each side saves for the last pick (R5 is the counter-pick slot), phase 2 bans aimed at the roles the enemy still needs, comfort vs meta, side choice, and how a team adjusts after losing a game.
- Numbers are one input, not the verdict. Combine them with MLBB game sense — comp identity (dive / poke / teamfight / split push), damage mix, frontline, crowd control, power spikes — and label what is data vs general knowledge.

DATA PACK
${pack.text}`;
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  let $panel, $thread, $in, $send, $team, $sub, $launch, $pg;
  function mount() {
    if (document.getElementById('hdPanel')) return;
    const st = document.createElement('style'); st.id = 'hd-style'; st.textContent = CSS; document.head.appendChild(st);
    $launch = document.createElement('button');
    $launch.className = 'hd-launch'; $launch.id = 'hdLaunch'; $launch.type = 'button';
    $launch.setAttribute('aria-label', 'Open Heimerdinger, the AI analyst');
    $launch.innerHTML = `${bot(40)}<span class="tip">Ask Heimerdinger</span>`;
    $launch.onclick = () => toggle(true);
    $panel = document.createElement('aside');
    $panel.className = 'hd-panel'; $panel.id = 'hdPanel'; $panel.setAttribute('aria-label', 'Heimerdinger chat');
    $panel.innerHTML = `
      <header class="hd-ph">
        <span class="hd-mark" id="hdMark">${bot(28)}</span>
        <div class="hd-ttl"><b>Heimerdinger</b><span id="hdSub">MLBB analyst</span></div>
        <span class="hd-dot" aria-hidden="true"></span>
        <button class="hd-ib" id="hdNew" type="button" title="New chat" aria-label="New chat"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="hd-ib" id="hdMin" type="button" title="Minimize" aria-label="Minimize"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>
        <button class="hd-ib" id="hdClose" type="button" title="Close" aria-label="Close">✕</button>
      </header>
      <div class="hd-ctx"><span>I'm on</span><button class="hd-pick" id="hdPick" type="button" aria-haspopup="true" aria-label="Choose your team"></button><span class="pg" id="hdPg"></span></div>
      <div class="hd-pop" id="hdPop" hidden>
        <div class="row"><span class="k">League</span><div class="row" id="hdPopLg"></div></div>
        <div class="row"><span class="k">Season</span><div class="row" id="hdPopSe"></div></div>
        <input id="hdPopQ" placeholder="Search teams…" autocomplete="off" aria-label="Search teams">
        <div class="hd-plist" id="hdPopList"></div>
        <button class="none" type="button" id="hdPopNone">I'm not on a team</button>
      </div>
      <div class="hd-thread" id="hdThread" aria-live="polite"></div>
      <form class="hd-form" id="hdForm">
        <textarea id="hdIn" class="hd-ta" rows="1" placeholder="Ask about a team, player, hero or draft…" aria-label="Message Heimerdinger"></textarea>
        <button class="hd-send" id="hdSend" type="submit" aria-label="Send"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </form>
      <div class="hd-note">Uses official matches and your own scrims only — never other teams' scrims.</div>`;
    document.body.appendChild($launch);
    document.body.appendChild($panel);
    $thread = $panel.querySelector('#hdThread'); $in = $panel.querySelector('#hdIn'); $send = $panel.querySelector('#hdSend');
    $team = $panel.querySelector('#hdPick'); $sub = $panel.querySelector('#hdSub'); $pg = $panel.querySelector('#hdPg');
    $team.onclick = () => togglePop();
    renderPick();
    $panel.querySelector('#hdPopQ').oninput = () => renderPop();
    $panel.querySelector('#hdPopNone').onclick = () => chooseTeam('');
    $panel.addEventListener('click', e => { const pop = $panel.querySelector('#hdPop'); if (!pop.hidden && e.target.isConnected && !pop.contains(e.target) && !$team.contains(e.target)) pop.hidden = true; });   // re-rendered chips are detached — not an outside click
    $panel.querySelector('#hdClose').onclick = e => { e.stopPropagation(); toggle(false); };
    $panel.querySelector('#hdMin').onclick = e => { e.stopPropagation(); setMin(!$panel.classList.contains('min')); };
    $panel.querySelector('.hd-ph').addEventListener('click', e => { if ($panel.classList.contains('min') && !e.target.closest('button')) setMin(false); });   // tap the bar to open again
    $panel.querySelector('#hdNew').onclick = () => { HD.chat = []; HD.ctxTeams = []; save(); render(); $in.focus(); };
    $panel.querySelector('#hdForm').onsubmit = e => { e.preventDefault(); ask($in.value); };
    $in.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($in.value); } });
    $in.addEventListener('input', () => { $in.style.height = 'auto'; $in.style.height = Math.min(120, $in.scrollHeight) + 'px'; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $panel.classList.contains('open')) toggle(false); });
    try { HD.chat = JSON.parse(localStorage.getItem(KEY()) || '[]'); } catch (_) { HD.chat = []; }
    try { if (sessionStorage.getItem('warr_heimer_open') === '1') { toggle(true); if (sessionStorage.getItem('warr_heimer_min') === '1') setMin(true); } } catch (_) {}
  }
  // Minimize: shrink to a small bar (keeps the chat and any answer in progress); tap it to open again
  function setMin(on) {
    if (!$panel) return;
    $panel.classList.toggle('min', !!on);
    if (!on) $panel.classList.remove('unread');
    const b = $panel.querySelector('#hdMin');
    if (b) { b.title = on ? 'Expand' : 'Minimize'; b.setAttribute('aria-label', b.title); b.innerHTML = on ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg>'; }
    try { sessionStorage.setItem('warr_heimer_min', on ? '1' : '0'); } catch (_) {}
    render();
    if (!on) setTimeout(() => $in && $in.focus(), 120);
  }
  function save() { try { localStorage.setItem(KEY(), JSON.stringify(HD.chat.slice(-30))); } catch (_) {} }
  async function toggle(open) {
    if ($panel.classList.contains('min')) { $panel.classList.remove('min', 'unread'); try { sessionStorage.setItem('warr_heimer_min', '0'); } catch (_) {} const b = $panel.querySelector('#hdMin'); if (b) { b.title = 'Minimize'; b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg>'; } }
    $panel.classList.toggle('open', open);
    $launch.classList.toggle('open', open);
    try { sessionStorage.setItem('warr_heimer_open', open ? '1' : '0'); } catch (_) {}
    if (!open) return;
    render();
    if (!HD.ready) { await ensureData(); fillTeams(); render(); }
    setTimeout(() => $in && $in.focus(), 150);
  }
  function hdLogo(name) {
    const mg = WDB.teamMonogram ? WDB.teamMonogram(name) : { init: '?', color: '#5E5CE6' };
    const src = WDB.teamLogo ? WDB.teamLogo(name) : '';
    return `<span class="hd-lg${src ? '' : ' noimg'}" style="--mc:${mg.color};">${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg')">` : ''}<i>${esc(mg.init)}</i></span>`;
  }
  function fillTeams() {
    let saved = ''; try { saved = localStorage.getItem(TEAMKEY) || ''; } catch (_) {}
    let prof = ''; try { const p = WAuth.getProfile(); if (p && p.team_name && p.team_status === 'approved') prof = p.team_name; } catch (_) {}
    if (saved === '-') saved = '';
    HD.myTeam = HD.myTeam || (HD.teams.includes(saved) ? saved : (HD.teams.includes(prof) ? prof : (pageCtx().blue || '')));
    renderPick();
  }
  function renderPick() {
    if (!$team) return;
    $team.innerHTML = HD.myTeam ? `${hdLogo(HD.myTeam)}<span class="nm">${esc(HD.myTeam)}</span><span class="car">▾</span>` : `<span class="nm" style="padding-left:5px;">Pick your team</span><span class="car">▾</span>`;
  }
  // ── Team picker: league → season (defaults to the active one) → team ──
  function officialLeagues() {
    const last = {};
    HD.usable.forEach(m => { if (isScrim(m) || !m.league) return; const t = Date.parse(m.date || '') || 0; last[m.league] = Math.max(last[m.league] || 0, t); });
    return Object.keys(last).sort((a, b) => last[b] - last[a]);
  }
  const activeSeason = lg => { const ss = seasonsOf(lg); return HD.cur[lg] && ss.includes(HD.cur[lg]) ? HD.cur[lg] : (ss[0] || ''); };
  function togglePop(force) {
    const pop = $panel.querySelector('#hdPop');
    const open = force !== undefined ? force : pop.hidden;
    if (open) {
      if (!HD.ready) return;
      HD.pickLg = HD.pickLg || (HD.myTeam && leagueOf(HD.myTeam)) || officialLeagues()[0] || '';
      if (HD.pickSe == null) HD.pickSe = activeSeason(HD.pickLg);
      $panel.querySelector('#hdPopQ').value = '';
      renderPop();
    }
    pop.hidden = !open;
    if (open) setTimeout(() => $panel.querySelector('#hdPopQ').focus(), 30);
  }
  function renderPop() {
    const lgs = officialLeagues(), ss = seasonsOf(HD.pickLg), act = activeSeason(HD.pickLg);
    const arg = v => esc(JSON.stringify(String(v)));
    $panel.querySelector('#hdPopLg').innerHTML = lgs.map(l => `<button type="button" class="hd-chip${l === HD.pickLg ? ' on' : ''}" data-lg="${arg(l)}">${esc(l)}</button>`).join('');
    $panel.querySelector('#hdPopSe').innerHTML = ss.map(x => `<button type="button" class="hd-chip${x === HD.pickSe ? ' on' : ''}" data-se="${arg(x)}">${esc(x)}${x === act ? '<span class="cur">active</span>' : ''}</button>`).join('')
      + `<button type="button" class="hd-chip${HD.pickSe === '' ? ' on' : ''}" data-se='""'>All</button>`;
    const q = ($panel.querySelector('#hdPopQ').value || '').trim().toLowerCase();
    const pool = HD.usable.filter(m => m.league === HD.pickLg && (!HD.pickSe || (m.season || '').trim() === HD.pickSe));
    const rec = {};
    pool.forEach(m => [['blue', m.blueTeam], ['red', m.redTeam]].forEach(([sd, t]) => { const x = rec[t] || (rec[t] = { w: 0, l: 0 }); if (m.winner === sd) x.w++; else x.l++; }));
    let R = null; try { R = WIntel.ratings(pool); } catch (_) {}
    let list = Object.keys(rec).filter(t => !locked(t)).sort((a, b) => ((R && R.r[b]) || 0) - ((R && R.r[a]) || 0));
    if (q) list = list.filter(t => t.toLowerCase().includes(q));
    $panel.querySelector('#hdPopList').innerHTML = list.length
      ? list.map(t => `<button type="button" class="hd-prow${t === HD.myTeam ? ' on' : ''}" data-team="${arg(t)}">${hdLogo(t)}<span>${esc(t)}</span><span class="rec">${rec[t].w}-${rec[t].l}</span></button>`).join('')
      : `<div style="font-size:12px;color:rgba(240,240,248,.45);padding:8px;">${q ? 'No team matches.' : 'No games here yet.'}</div>`;
    $panel.querySelectorAll('#hdPopLg [data-lg]').forEach(b => b.onclick = () => { HD.pickLg = JSON.parse(b.dataset.lg); HD.pickSe = activeSeason(HD.pickLg); renderPop(); });
    $panel.querySelectorAll('#hdPopSe [data-se]').forEach(b => b.onclick = () => { HD.pickSe = JSON.parse(b.dataset.se); renderPop(); });
    $panel.querySelectorAll('#hdPopList [data-team]').forEach(b => b.onclick = () => chooseTeam(JSON.parse(b.dataset.team)));
  }
  function chooseTeam(t) {
    HD.myTeam = t;
    // a non-active season picked here also becomes the scope of the answers for that league
    HD.seOverride = (t && HD.pickLg && HD.pickSe !== activeSeason(HD.pickLg)) ? { league: HD.pickLg, season: HD.pickSe } : null;
    try { localStorage.setItem(TEAMKEY, t || '-'); } catch (_) {}
    togglePop(false); renderPick(); render();
  }
  function suggestions() {
    const pc = pageCtx();
    let opp = (pc.red && pc.red !== HD.myTeam) ? pc.red : (pc.blue && pc.blue !== HD.myTeam ? pc.blue : '');
    let lg = HD.myTeam ? leagueOf(HD.myTeam) : '';
    if (!lg && HD.usable.length) { const c = {}; HD.usable.filter(m => !isScrim(m)).forEach(m => { c[m.league] = (c[m.league] || 0) + 1; }); lg = Object.keys(c).sort((x, y) => c[y] - c[x])[0] || ''; }
    if (!opp && lg && window.WIntel) {
      const sc = scopeOf('', lg), R = WIntel.ratings(sc.pool);
      opp = Object.keys(R.r).filter(t => t !== HD.myTeam && !locked(t)).sort((a, b) => R.r[b] - R.r[a])[0] || '';
    }
    const se = lg ? (scopeOf('', lg).seasons[0] || '') : '';
    const s = [];
    if (opp) s.push(`What's ${opp}'s biggest weakness right now?`);
    if (opp && HD.myTeam) s.push(`How do we beat ${opp} in a BO5?`);
    if (opp) s.push(`What does ${opp} first-pick, and what do they take when it's banned?`);
    if (lg) s.push(`Which heroes are most contested in ${lg}${se ? ' ' + se : ''}?`);
    if (!HD.myTeam && lg) s.push(`Who's the strongest team in ${lg} right now, and why?`);
    return s.slice(0, 4);
  }
  function render() {
    if (!$thread) return;
    const ai = hasAI();
    $sub.textContent = $panel.classList.contains('min') ? (HD.busy ? 'Thinking… ' + (HD.step || '') : $panel.classList.contains('unread') ? 'New reply — tap to open' : 'Tap to open')
      : ai && !(HD.liteUntil > Date.now()) ? 'MLBB analyst · Claude Sonnet 5.5' : 'Heimer Lite · free mode';
    const pt = pageTeams();
    $pg.textContent = pt.length ? `· on screen: ${pt.join(' vs ')}` : '';
    $in.disabled = HD.busy; $send.disabled = HD.busy;
    let html = '';
    if (!HD.chat.length) {
      if (!ai || HD.liteUntil > Date.now()) html += `<div class="hd-gate"><b>Free mode.</b> I answer straight from Warr.GG's data — every number is real, nothing is generated. ${ai ? "The AI budget is resting right now." : `Full Heimer (Claude) is invite-only — <a href="mailto:wrrenvillapando@gmail.com?subject=Warr.GG%20%E2%80%94%20Heimerdinger%20access">ask Warr</a>.`}</div>`;
      const sug = HD.ready ? suggestions() : [];
      html += `<div class="hd-empty"><p>Ask me about any team, player, matchup, hero or draft. I dig through all of Warr.GG's match data myself — any league, season, stage, side or patch — and show the numbers behind every call.</p>
        ${!HD.ready ? `<div class="hd-think"><span class="hd-dots"><i></i><i></i><i></i></span> Loading match data…</div>` : ''}
        ${sug.map(x => `<button class="hd-sug" type="button" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
    }
    HD.chat.forEach(m => {
      if (m.role === 'user') html += `<div class="hd-u">${esc(m.content)}</div>`;
      else html += `<div class="hd-a${m.err ? ' err' : ''}"><div class="who">${bot(16)} Heimerdinger</div><div class="md">${md(m.content)}</div>${m.meta ? `<div class="meta">${esc(m.meta)}</div>` : ''}</div>`;
    });
    if (HD.busy) html += `<div class="hd-a"><div class="hd-think">${bot(22, 'thinking')} <span id="hdT">${esc(HD.step || 'Reading the data…')}</span> <span class="hd-dots"><i></i><i></i><i></i></span></div></div>`;
    const mk = document.querySelector('#hdMark .hd-bot'); if (mk) mk.classList.toggle('thinking', !!HD.busy);
    $thread.innerHTML = html;
    $thread.querySelectorAll('.hd-sug').forEach(b => b.onclick = () => ask(b.dataset.q));
    $thread.scrollTop = $thread.scrollHeight;
  }
  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || HD.busy) return;
    await ensureData();
    $in.value = ''; $in.style.height = 'auto';
    const history = HD.chat.filter(m => !m.err && !m.lite).slice(-10).map(m => ({ role: m.role, content: m.content }));
    while (history.length && history[0].role !== 'user') history.shift();
    HD.chat.push({ role: 'user', content: q, ts: Date.now() });
    HD.busy = true; HD.step = ''; render();
    const t0 = Date.now();
    const tick = setInterval(() => {
      const el = document.getElementById('hdT'); if (!el) return;
      const s = Math.round((Date.now() - t0) / 1000);
      el.textContent = HD.step ? `${HD.step} ${s}s` : (s < 4 ? 'Reading the data…' : `Thinking… ${s}s`);
    }, 1000);
    try {
      // Free mode: no AI access (or the budget is used up) → Heimer Lite answers
      // straight from the data tools. Nothing is generated, so nothing is invented.
      if (!hasAI() || HD.liteUntil > Date.now()) { await liteAnswer(q, hasAI() ? 'The AI budget is resting, so this is free mode.' : ''); return; }
      if (WDB.canAnalyze && !WDB.canAnalyze()) throw Object.assign(new Error('Monthly AI limit reached for your access level.'), { code: 'LIMIT' });
      const pack = buildPack(q);
      if (pack.teams.length) HD.ctxTeams = pack.teams;
      const { d, checked } = await agentLoop(systemPrompt(pack), [...history, { role: 'user', content: q }]);
      try { WDB.consumeToken && WDB.consumeToken(); } catch (_) {}
      const out = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || '(no answer)';
      const mid = d.warr_model || d.model || '';
      const model = /opus/i.test(mid) ? 'Opus 5.5' : /sonnet-5/i.test(mid) ? 'Sonnet 5.5' : (mid ? 'Claude' : '');
      HD.chat.push({ role: 'assistant', content: out, ts: Date.now(), meta: `Based on ${pack.used.join(' · ') || 'league data'}${checked.length ? ' · checked: ' + checked.join(', ') : ''}${model ? ' · ' + model : ''}` });
    } catch (e) {
      const c = e && e.code;
      // Budget / access / limit / timeout → answer in free mode instead of failing.
      const why = c === 'USER_DAILY_CAP' || c === 'FREE_PLAN_CAP' || c === 'LIMIT' || c === 'USER_MONTHLY_CAP' ? 'Your AI limit for now is used up, so this is free mode.'
        : c === 'BUDGET_EXCEEDED' || c === 'BUDGET_LOW' ? "This month's AI budget is used up, so this is free mode."
        : c === 'NO_AI_ACCESS' ? ''
        : c === 'AI_TIMEOUT' ? 'The AI took too long, so here is the data answer.'
        : 'The AI is unavailable right now, so here is the data answer.';
      if (c === 'BUDGET_EXCEEDED' || c === 'BUDGET_LOW' || c === 'USER_MONTHLY_CAP' || c === 'USER_DAILY_CAP' || c === 'NO_AI_ACCESS') HD.liteUntil = Date.now() + 30 * 60 * 1000;   // don't retry the API for a while
      try { await liteAnswer(q, why); }
      catch (e2) { HD.chat.push({ role: 'assistant', content: `Something went wrong: ${(e2 && e2.message) || e2}`, err: true, ts: Date.now() }); }
    } finally {
      clearInterval(tick);
      HD.busy = false; HD.step = '';
      if ($panel && $panel.classList.contains('min')) $panel.classList.add('unread');   // answer arrived while minimized
      save(); render();
    }
  }

  // Heimer Lite — the same tools, no language model.
  async function liteAnswer(q, note) {
    const T = window.HeimerTools;
    if (!T || !T.lite) throw new Error('data tools not loaded');
    setStep('Pulling the data…');
    let page = null; try { page = typeof window.heimerContext === 'function' ? window.heimerContext() : null; } catch (_) {}
    const ctx = { usable: HD.usable, locked, cur: HD.cur, myTeam: HD.myTeam, heroes: HD.heroes };
    const r = await T.lite(q, ctx, page);
    HD.chat.push({ role: 'assistant', content: (note ? `*${note}*\n\n` : '') + r.text, ts: Date.now(), lite: true,
      meta: 'Heimer Lite · free mode · straight from the data, nothing generated' });
  }

  // Ask → (tool calls → results)* → answer. Tools run in this browser over the
  // data the user can already see; the last round forbids tools so the loop
  // always ends with an answer.
  const MAX_TOOL_ROUNDS = 4;
  async function agentLoop(system, messages) {
    const T = window.HeimerTools;
    const msgs = messages.slice(), checked = [];
    const ctx = { usable: HD.usable, locked, cur: HD.cur, myTeam: HD.myTeam, heroes: HD.heroes };
    let d = null, prev = '';
    for (let round = 0; ; round++) {
      const lastRound = !T || round >= MAX_TOOL_ROUNDS;
      d = await WDB.callClaude({
        purpose: 'chat', max_tokens: 1800, system, messages: msgs,
        ...(T ? { tools: T.defs, tool_choice: { type: lastRound ? 'none' : 'auto' } } : {}),
        ...(prev ? { prev_model: prev } : {}),
      });
      prev = d.warr_model || d.model || '';
      const uses = (d.content || []).filter(b => b.type === 'tool_use');
      if (lastRound || d.stop_reason !== 'tool_use' || !uses.length) break;
      msgs.push({ role: 'assistant', content: d.content });
      const results = [];
      for (const u of uses) {
        const label = T.describe(u.name, u.input, ctx);
        setStep(label);
        checked.push(label.replace(/…$/, '').replace(/^(Pulling|Scouting|Reading|Comparing|Looking up|Checking|Running|Predicting) (the )?/, '').trim());
        let out = '';
        try { out = await T.run(u.name, u.input, ctx); } catch (e) { out = 'ERROR: ' + ((e && e.message) || e); }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: out || '(empty)' });
      }
      msgs.push({ role: 'user', content: results });
    }
    return { d, checked: [...new Set(checked)].slice(0, 6) };
  }
  function setStep(label) {
    HD.step = label; HD.stepAt = Date.now();
    const el = document.getElementById('hdT'); if (el) el.textContent = label;
  }

  // Public hook (e.g. an "Ask Heimerdinger" button on the Analysis page)
  window.Heimer = {
    open: (prefill) => { toggle(true); if (prefill && $in) { $in.value = prefill; $in.dispatchEvent(new Event('input')); $in.focus(); } },
    ask: (q) => { toggle(true).then(() => ask(q)); },
  };

  // Signed-in users only. Auth resolves asynchronously, so wait for it a bit.
  function boot(tries) {
    if (/\/(auth|404)(\.html)?$/.test(location.pathname)) return;
    if (typeof WAuth === 'undefined' || typeof WDB === 'undefined') return;
    if (user()) { mount(); return; }
    if (tries < 20) setTimeout(() => boot(tries + 1), 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(() => boot(0), 300));
  else setTimeout(() => boot(0), 300);
})();
