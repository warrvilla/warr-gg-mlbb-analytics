// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — Liquipedia (Mobile Legends) wikitext readers. Pure functions, no I/O.
//
//   parseHero(wikitext)   {{Infobox hero}} base stats + every {{AbilityCard}}
//   parsePatch(wikitext)  {{Infobox patch}} release date + every {{Herobc/New}}
//                         block: hero, buff / nerf / adjust / revamp, per-skill
//                         "old >> new" numbers with a signed size
//
// Liquipedia content is CC-BY-SA 3.0 — the site credits it wherever it's shown.
// ═══════════════════════════════════════════════════════════════════════

// Top-level {{templates}} in text → [{ name, params, start, end }] (brace-aware).
export function templates(text) {
  const out = []; const n = text.length; let i = 0;
  while (i < n) {
    const j = text.indexOf('{{', i);
    if (j < 0) break;
    let depth = 0, k = j;
    while (k < n) {
      if (text.startsWith('{{', k)) { depth++; k += 2; continue; }
      if (text.startsWith('}}', k)) { depth--; k += 2; if (depth === 0) break; continue; }
      k++;
    }
    if (depth !== 0) break;
    out.push({ ...splitTemplate(text.slice(j + 2, k - 2)), start: j, end: k });
    i = k;
  }
  return out;
}

function splitTemplate(body) {
  const parts = []; let buf = '', d = 0, sq = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.substr(i, 2);
    if (two === '{{') { d++; buf += two; i++; continue; }
    if (two === '}}') { d--; buf += two; i++; continue; }
    if (two === '[[') { sq++; buf += two; i++; continue; }
    if (two === ']]') { sq--; buf += two; i++; continue; }
    if (body[i] === '|' && d === 0 && sq === 0) { parts.push(buf); buf = ''; continue; }
    buf += body[i];
  }
  parts.push(buf);
  const name = parts.shift().replace(/<!--[\s\S]*?-->/g, '').trim();
  const params = {}; let pos = 1;
  parts.forEach(p => {
    const m = /^\s*([A-Za-z0-9_ \-]{1,40}?)\s*=([\s\S]*)$/.exec(p);
    if (m) params[m[1].toLowerCase().replace(/\s+/g, ' ')] = m[2].trim();
    else params[String(pos++)] = p.trim();
  });
  return { name, params };
}

// Wikitext → readable text (formatting templates keep their words).
export function plain(text) {
  let t = String(text || '');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<ref[^>]*\/>/g, ' ').replace(/<ref[\s\S]*?<\/ref>/g, ' ');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(?:p|div|li|h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  for (let g = 0; g < 8; g++) {
    const t2 = t.replace(/\{\{([^{}]*)\}\}/g, (_, body) => {
      const { name, params } = splitTemplate(body);
      const nm = name.toLowerCase(), pos = Object.keys(params).filter(k => /^\d+$/.test(k)).map(k => params[k]);
      if (/^(hiddensort|clear|-|!|anchor|#ev|box|abbr\/?)$/.test(nm) || nm.startsWith('#')) return '';
      if (/icon$|^heroicon|^itemicon|^emblem/.test(nm)) return pos[0] || '';
      if (nm === 'bgcolortext' || nm === 'color' || nm === 'colortext' || nm === 'tooltip') return pos[pos.length - 1] || '';
      return pos.join(' ');
    });
    if (t2 === t) break; t = t2;
  }
  t = t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, ' ').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1');
  t = t.replace(/'''?/g, '').replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  return t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// Numbers in text. Patch notes write ranges as "14-12s" / "42%-70%", so a minus
// sign is never read as negative (MLBB notes don't use negative values).
export const nums = s => (String(s || '').match(/(?<![\d.])\d+(?:\.\d+)?/g) || []).map(Number);
const num1 = s => { const a = nums(s); return a.length ? a[0] : null; };
const clip = (x, a, b) => Math.max(a, Math.min(b, x));

const STAT_KEYS = ['hp', 'hpreg', 'mana', 'manareg', 'phyatk', 'phydef', 'magdef', 'atkspeed', 'atkspeedratio', 'movespeed', 'mp'];
const INFO_KEYS = ['name', 'title', 'lane', 'primaryrole', 'secondaryrole', 'specialty1', 'specialty2', 'resourcebar', 'releasedate'];
const SLOT_OF = h => {
  const s = h.toLowerCase();
  if (/passive/.test(s)) return 'passive';
  if (/ultimate/.test(s)) return 'ultimate';
  const m = /skill\s*(\d)/.exec(s); if (m) return 'skill' + m[1];
  return '';
};

// One hero page → { info, stats, skills: [{ slot, name, types, cd, cost, vamp, values, text }] }
export function parseHero(wt) {
  wt = String(wt || '');
  const tpls = templates(wt);
  const ib = tpls.find(t => /^infobox hero$/i.test(t.name));
  const info = {}, stats = {};
  if (ib) {
    INFO_KEYS.forEach(k => { if (ib.params[k]) info[k] = plain(ib.params[k]).slice(0, 80); });
    STAT_KEYS.forEach(k => { const v = num1(ib.params[k]); if (v != null) stats[k] = v; });
  }
  const heads = []; const re = /^(=+)\s*(.+?)\s*\1\s*$/gm; let m;
  while ((m = re.exec(wt))) heads.push({ at: m.index, level: m[1].length, text: plain(m[2]) });
  const ab = heads.find(h => h.level === 2 && /abilit|skill/i.test(h.text));
  const abEnd = ab ? (heads.find(h => h.at > ab.at && h.level <= ab.level) || { at: wt.length }).at : wt.length;
  const skills = []; const seen = new Set();
  tpls.filter(t => /^abilitycard$/i.test(t.name) && (!ab || (t.start > ab.at && t.start < abEnd))).forEach((t, i) => {
    const p = t.params;
    const head = heads.filter(h => h.at < t.start).pop();
    let slot = head ? SLOT_OF(head.text) : '';
    if (!slot) slot = i === 0 ? 'passive' : 'skill' + i;
    const name = plain(p.name || '').slice(0, 80);
    const text = plain(p.desc || p.description || '').slice(0, 900);
    const key = slot + '|' + name + '|' + text.slice(0, 120);
    if (seen.has(key)) return; seen.add(key);
    const values = {};
    Object.keys(p).forEach(k => {
      const mm = /^stats(\d+)$/.exec(k);
      if (mm && p[k + '_value'] != null) values[plain(p[k]).slice(0, 40) || 'stat' + mm[1]] = nums(p[k + '_value']).slice(0, 12);
    });
    const types = String(plain(p.type || '')).split(/[,/]/).map(x => x.replace(/\d+$/, '').trim()).filter(Boolean);
    let cd = values.Cooldown || values.cooldown || null;
    if (!cd && p.cd != null && num1(p.cd) != null) cd = [num1(p.cd)];
    const cost = values['Skill Cost'] || (p.mana != null && num1(p.mana) != null ? [num1(p.mana)] : null);
    skills.push({ slot, name, types, cd, cost, vamp: num1(p.vamp), values, text });
  });
  return { info, stats, skills };
}

// ── Patch notes ──────────────────────────────────────────────────────────
const LOWER_BETTER = /cool ?down|\bcd\b|cost|cast(?:ing)? time|fore ?swing|back ?swing|delay|charge time|recharge|channel|damage (?:taken|received)|respawn/i;
const SLOT_W = { passive: 0.7, ultimate: 1, attributes: 0.6, stats: 0.6 };
const TYPE_DIR = t => /buff/.test(t) ? 1 : /nerf/.test(t) ? -1 : 0;

// "Cooldown: 14-12s >> 15s at all levels" → { label, from, to, rel, better }
export function parseChangeLine(line) {
  const s = String(line || '').replace(/&gt;/g, '>');
  const at = s.indexOf('>>');
  if (at < 0) return null;
  let left = s.slice(0, at), right = s.slice(at + 2);
  let label = '';
  const ci = left.lastIndexOf(':');
  if (ci >= 0) { label = left.slice(0, ci).trim(); left = left.slice(ci + 1); }
  const base = x => nums(x.replace(/\([^)]*\)/g, ' ').replace(/\b(?:level|lv|lvl)\s*\d+/gi, ' '));
  const scal = x => (x.match(/\(([^)]*)\)/g) || []).flatMap(nums);
  const mean = a => a.reduce((p, q) => p + q, 0) / a.length;
  const rel = (a, b) => (a.length && b.length && mean(a) !== 0) ? clip((mean(b) - mean(a)) / Math.abs(mean(a)), -1, 1) : null;
  let r = rel(base(left), base(right));
  const rs = rel(scal(left), scal(right));
  if (r == null && rs != null) r = rs; else if (r != null && rs != null) r = 0.7 * r + 0.3 * rs;
  const sign = LOWER_BETTER.test(label) ? -1 : 1;
  return { label: label.slice(0, 60), from: left.trim().slice(0, 80), to: right.trim().slice(0, 80), rel: r == null ? null : +(r.toFixed(3)), better: r == null ? 0 : Math.sign(r) * sign };
}

// One patch page → { name, release, previous, next, heroes: [{ hero, type, note, score, slots: [...] }] }
export function parsePatch(wt, title) {
  wt = String(wt || '');
  const tpls = templates(wt);
  const ib = tpls.find(t => /^infobox patch$/i.test(t.name));
  const name = String((ib && plain(ib.params.name)) || title || '').replace(/^Patch\s+/i, '').trim();
  const release = ib && /\d{4}-\d{2}-\d{2}/.test(ib.params.release || '') ? ib.params.release.match(/\d{4}-\d{2}-\d{2}/)[0] : '';
  const heroes = [];
  const walk = (list) => list.forEach(t => {
    if (/^herobc/i.test(t.name) && t.params.hero) heroes.push(readHeroBlock(t.params));
    else Object.values(t.params).forEach(v => { if (v && v.includes('{{Herobc')) walk(templates(v)); });
  });
  walk(tpls);
  const merged = {};                       // a hero listed twice (revamp + adjustment) → one entry
  heroes.forEach(h => {
    const o = merged[h.hero];
    if (!o) { merged[h.hero] = h; return; }
    o.slots.push(...h.slots); o.score = +(o.score + h.score).toFixed(3); if (h.type === 'revamp') o.type = 'revamp'; if (h.note && !o.note.includes(h.note)) o.note = (o.note + ' ' + h.note).trim();
  });
  return { name, release, previous: ib ? plain(ib.params.previous || '') : '', next: ib ? plain(ib.params.next || '') : '', heroes: Object.values(merged) };
}

function readHeroBlock(p) {
  const hero = plain(p.hero).trim();
  const type = plain(p.type || '').toLowerCase().trim();
  const skip = new Set(['hero', 'herotitle', 'note', 'type', 'image']);
  const bases = new Set();
  Object.keys(p).forEach(k => {
    if (skip.has(k) || /^\d+$/.test(k)) return;
    const b = k.replace(/\s*(name|type)$/, '');
    if (b && !skip.has(b)) bases.add(b);
  });
  const slots = [];
  bases.forEach(b => {
    const raw = p[b]; if (raw == null || !String(raw).trim()) return;
    const sType = plain(p[b + 'type'] || p[b + ' type'] || '').toLowerCase() || type;
    const txt = plain(raw);
    const lines = txt.split('\n');
    const changes = []; const seenC = new Set(); let lastLabel = '';
    lines.forEach(l => {
      const c = parseChangeLine(l);
      if (!c) { lastLabel = /:\s*$/.test(l) ? l.replace(/:\s*$/, '').trim() : ''; return; }
      if (!c.label && lastLabel) { const c2 = parseChangeLine(lastLabel + ': ' + l); if (c2) Object.assign(c, c2); }
      const k = c.label + '|' + c.from + '|' + c.to;
      if (!seenC.has(k)) { seenC.add(k); changes.push(c); }
      lastLabel = '';
    });
    const quals = lines.filter(l => !l.includes('>>') && /new effect|now |no longer|removed|added|increase|reduce|decrease/i.test(l)).length;
    const numeric = changes.filter(c => c.rel != null);
    const mag = clip((numeric.length ? numeric.reduce((s, c) => s + Math.min(0.5, Math.abs(c.rel)), 0) / Math.sqrt(numeric.length) : 0) + 0.04 * quals, 0, 1);
    let dir = TYPE_DIR(sType);
    if (!dir) { const net = numeric.reduce((s, c) => s + c.better * Math.min(0.5, Math.abs(c.rel)), 0); dir = Math.abs(net) > 0.02 ? Math.sign(net) : 0; }
    const slot = /^skill\d$|^passive$|^ultimate$/.test(b) ? b : (b === 'attribute' || b === 'attributes' || b === 'stats' ? 'attributes' : b);
    const w = SLOT_W[slot] || 0.8;
    slots.push({ slot, name: plain(p[b + 'name'] || '').slice(0, 80), type: sType, dir, size: +(mag * w).toFixed(3), changes: changes.slice(0, 12), text: txt.slice(0, 700) });
  });
  const isRevamp = /revamp|new hero|rework/.test(type);
  let score = isRevamp ? 0 : clip(slots.reduce((s, x) => s + x.dir * x.size, 0), -1.5, 1.5);
  // The designers' own buff / nerf label decides the overall direction.
  const td = TYPE_DIR(type);
  if (!isRevamp && td && Math.sign(score) !== td) score = td * Math.max(0.05, Math.abs(score) * 0.5);
  return { hero, type: isRevamp ? 'revamp' : (type || (score > 0.02 ? 'buff' : score < -0.02 ? 'nerf' : 'adjust')), note: plain(p.note || '').slice(0, 400), score: +score.toFixed(3), slots };
}

// "Patch 2.2.16a" → sortable key [2, 2, 16, 1]
export function patchKey(title) {
  const m = /(\d+)\.(\d+)\.(\d+)\s*([a-zA-Z]*)/.exec(String(title || ''));
  if (!m) return null;
  const suf = (m[4] || '').toLowerCase();
  return [Number(m[1]), Number(m[2]), Number(m[3]), suf ? suf.charCodeAt(0) - 96 : 0];
}
export const cmpPatch = (a, b) => { const x = patchKey(a), y = patchKey(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// ── What a kit DOES, read from the skill text (feeds hero profiles + Heimer) ──
const CC_WORDS = [['stun', /\bstun/], ['airborne', /airborne|knock(?:s|ing|ed)? (?:them |enemies |the target |all enemies |nearby enemies )?up\b/], ['knockback', /knock(?:s|ing|ed)? (?:them |enemies |the target )?back/],
  ['suppress', /suppress(?:es|ing)? (?:the |an |a |all )?(?:target|enem|nearby)/], ['freeze', /\bfreez|frozen/], ['petrify', /petrif/], ['taunt', /\btaunt/], ['charm', /\bcharm/], ['immobilize', /immobil|\broot|\bbind|\btether/],
  ['pull', /(?:pull|drag|grab|hook)s? (?:the |an |all |nearby |that )?(?:target|enem|opponent)|pull(?:s|ing)? (?:them|enemies) (?:toward|to|back)/], ['silence', /silenc/], ['sleep', /\bsleep|\bdrows/], ['fear', /\bfear|terrif/], ['transform', /transforms? (?:the )?(?:target|enem)/]];
export function heroTraits(h) {
  const sk = (h && h.skills) || [];
  const all = sk.map(s => s.text).join('\n').toLowerCase();
  const types = sk.flatMap(s => s.types.map(t => t.toLowerCase()));
  const hasT = t => types.includes(t);
  const hard = CC_WORDS.filter(([, re]) => re.test(all)).map(([k]) => k);
  let ccMax = 0;
  all.split(/(?<=[.!?])\s+|\n/).forEach(sent => {
    if (!CC_WORDS.some(([, re]) => re.test(sent))) return;
    (sent.match(/(\d+(?:\.\d+)?)\s*s\b/g) || []).forEach(x => { const v = parseFloat(x); if (v <= 3.5) ccMax = Math.max(ccMax, v); });
  });
  const dashes = sk.filter(s => s.types.some(t => /mobility|teleport|charge/i.test(t)) || /\b(dash|blink|leap|lunge|teleport|jumps?|charges? (?:forward|toward))/i.test(s.text)).length;
  const count = re => (all.match(re) || []).length;
  const phys = count(/physical damage/g), mag = count(/magic damage/g), tru = count(/true damage/g);
  const ult = sk.find(s => s.slot === 'ultimate');
  const cds = sk.filter(s => s.slot !== 'ultimate' && s.slot !== 'passive' && s.cd && s.cd.length).map(s => s.cd[0]);
  return {
    hardCC: hard, cc: hard.length + (/\bslow/.test(all) ? 0.5 : 0), ccMax: +ccMax.toFixed(1), slow: /\bslow/.test(all),
    dashes, invis: hasT('camouflage') || hasT('conceal') || /camouflage|invisib|stealth/.test(all),
    invincible: hasT('invincible') || hasT('death immunity') || /invincib|untargetable|immune to (?:all )?damage|cannot be targeted/.test(all),
    ccImmune: hasT('cc immune') || hasT('remove cc') || /control immunity|immune to (?:crowd )?control|cc immun|purif|removes? (?:all )?(?:negative|debuff|control)/.test(all),
    sustain: count(/\bheal|restores? \d|recover|regen|lifesteal|spell vamp/g) + (hasT('heal') ? 1 : 0) + sk.filter(s => s.vamp).length * 0.5,
    shield: hasT('shield') || /\bshield/.test(all),
    antiheal: /(?:reduc|lower|decreas)\w*[^.\n]{0,45}(?:hp regen|healing effect|healing received|regen\b)|anti-?heal|healing reduction/.test(all),
    trueDmg: tru > 0, pctHp: /% (?:of )?(?:the )?(?:target'?s?|enem\w*'?s?) (?:max(?:imum)?|current) hp/.test(all),
    execute: /(?:target|enem\w*)'?s? (?:lost|missing) hp|below \d+% (?:of their )?(?:max )?hp|hp is below|hp below/.test(all),
    global: /\bglobal|anywhere on the map|entire map|across the map|all allied heroes|any allied hero/.test(all),
    shred: /(?:reduc|ignor|lower)\w* .{0,30}(?:defense|defence)|penetration/.test(all),
    aoe: types.filter(t => t === 'aoe').length, burst: types.filter(t => t === 'burst').length,
    dmg: tru > Math.max(phys, mag) ? 'X' : phys && mag && Math.min(phys, mag) / Math.max(phys, mag) > 0.4 ? 'X' : mag > phys ? 'M' : 'P',
    ultCd: ult && ult.cd && ult.cd.length ? [ult.cd[0], ult.cd[ult.cd.length - 1]] : null,
    cd: cds.length ? +(cds.reduce((a, b) => a + b, 0) / cds.length).toFixed(1) : null,
  };
}
