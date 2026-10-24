// ═══════════════════════════════════════════════════════════════════════
// Warr.GG — hero profiles: what each hero DOES (match data can't tell us this)
//
// Used by the draft brain to understand WHY drafts work — "they have no engage,
// so they'll want Atlas", "five mobile heroes → Khufra punishes them" — and to
// reason about heroes that are rarely picked. Edit freely: one line per hero.
//
// Columns (0 = none … 3 = elite):
//   en   engage / initiation        cc    crowd control        mob   mobility
//   rng  range (0 melee … 3 long)   sus   sustain / healing    tank  durability
//   bur  burst                      dps   sustained damage     poke  long-range chip
//   obj  objective control          wave  wave clear / push
//   spike  power spike: E early · M mid · L late
//   dmg    P physical · M magic · X mixed / true damage
//   tags   engage peel frontline teamfight pickoff dive poke scale split zone
//          global protect antimob (stops dashes) shred (kills tanks) antiheal
//          sustain invis vision push lock (suppress / lockdown) flex
// Rows marked // review are newer heroes — check them.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const COLS = ['en', 'cc', 'mob', 'rng', 'sus', 'tank', 'bur', 'dps', 'poke', 'obj', 'wave', 'spike', 'dmg', 'tags'];
  const D = {
    // ── Tanks ──                en cc mob rng sus tank bur dps poke obj wave spike dmg tags
    'Tigreal':      [3, 3, 1, 0, 0, 3, 0, 0, 0, 1, 1, 'E', 'P', 'engage teamfight frontline peel'],
    'Akai':         [2, 2, 2, 0, 1, 3, 0, 1, 0, 1, 1, 'E', 'P', 'engage frontline peel'],
    'Franco':       [2, 3, 1, 1, 0, 2, 1, 0, 0, 1, 0, 'E', 'P', 'pickoff lock engage'],
    'Minotaur':     [3, 3, 1, 0, 2, 3, 0, 0, 0, 1, 1, 'M', 'P', 'engage teamfight frontline sustain'],
    'Lolita':       [1, 3, 1, 0, 0, 3, 0, 0, 0, 1, 0, 'M', 'P', 'peel protect teamfight zone frontline'],
    'Johnson':      [3, 2, 3, 0, 0, 3, 1, 0, 0, 1, 0, 'E', 'M', 'engage pickoff dive global'],
    'Atlas':        [3, 3, 1, 0, 0, 3, 1, 0, 0, 1, 1, 'M', 'M', 'engage teamfight frontline'],
    'Khufra':       [3, 3, 2, 0, 0, 3, 0, 0, 0, 1, 0, 'E', 'P', 'engage pickoff peel antimob frontline'],
    'Esmeralda':    [2, 1, 2, 0, 3, 3, 1, 2, 0, 1, 2, 'M', 'M', 'frontline sustain shred flex'],
    'Uranus':       [1, 1, 2, 0, 3, 3, 0, 1, 0, 1, 2, 'L', 'M', 'frontline sustain split'],
    'Hylos':        [2, 2, 2, 0, 2, 3, 0, 1, 0, 1, 1, 'M', 'P', 'engage frontline peel flex'],
    'Belerick':     [1, 2, 1, 0, 2, 3, 0, 1, 0, 1, 1, 'M', 'M', 'frontline peel teamfight'],
    'Grock':        [2, 2, 1, 0, 1, 3, 1, 1, 0, 2, 1, 'E', 'P', 'engage zone teamfight frontline flex'],
    'Carmilla':     [2, 3, 1, 0, 1, 2, 0, 0, 0, 1, 1, 'M', 'M', 'teamfight engage'],
    'Baxia':        [2, 1, 3, 0, 1, 3, 0, 1, 0, 2, 2, 'E', 'M', 'dive antiheal frontline engage'],
    'Gloo':         [2, 2, 2, 0, 2, 3, 0, 1, 0, 1, 1, 'M', 'M', 'dive frontline flex'],
    'Chip':         [1, 2, 3, 0, 1, 2, 0, 0, 0, 1, 0, 'M', 'P', 'global peel protect'],
    'Fredrinn':     [2, 2, 2, 0, 2, 3, 1, 2, 0, 2, 2, 'M', 'P', 'frontline teamfight flex'],
    'Kalea':        [2, 3, 2, 0, 2, 2, 1, 1, 0, 1, 1, 'M', 'P', 'engage teamfight frontline pickoff'],   // kit: Liquipedia (roam, physical, airborne + grab)
    'Edith':        [2, 2, 2, 1, 1, 3, 1, 2, 0, 1, 1, 'M', 'P', 'frontline teamfight flex'],
    'Marcel':       [2, 2, 1, 0, 1, 3, 0, 1, 0, 1, 1, 'M', 'P', 'frontline engage'],                    // review
    // ── Fighters ──
    'Barats':       [2, 2, 1, 0, 2, 3, 1, 2, 0, 2, 2, 'M', 'P', 'frontline teamfight flex'],
    'Balmond':      [1, 1, 1, 0, 2, 2, 1, 2, 0, 2, 2, 'E', 'P', 'teamfight frontline'],
    'Zilong':       [1, 1, 2, 0, 1, 1, 1, 2, 0, 2, 1, 'L', 'P', 'split pickoff'],
    'Alucard':      [0, 0, 2, 0, 3, 1, 1, 2, 0, 1, 2, 'M', 'P', 'split sustain'],
    'Alpha':        [2, 2, 2, 0, 1, 2, 1, 2, 0, 2, 2, 'M', 'P', 'teamfight engage flex'],
    'Sun':          [0, 0, 1, 0, 1, 1, 0, 3, 0, 3, 2, 'L', 'P', 'split push'],
    'Argus':        [0, 0, 2, 0, 1, 1, 1, 3, 0, 2, 1, 'L', 'P', 'split dive scale'],
    'Hilda':        [1, 1, 2, 0, 2, 2, 2, 1, 0, 1, 1, 'E', 'P', 'pickoff dive flex'],
    'Ruby':         [1, 3, 2, 0, 3, 2, 0, 1, 0, 1, 1, 'M', 'P', 'teamfight peel sustain flex'],
    'X.Borg':       [1, 1, 2, 1, 2, 2, 1, 3, 1, 1, 2, 'M', 'X', 'teamfight poke'],
    'Aldous':       [1, 1, 3, 0, 1, 2, 3, 0, 0, 1, 1, 'L', 'P', 'scale pickoff global'],
    'Chou':         [3, 3, 3, 0, 1, 1, 2, 0, 0, 1, 0, 'E', 'P', 'engage pickoff dive lock flex'],
    'Badang':       [1, 2, 2, 0, 1, 2, 2, 1, 0, 1, 1, 'M', 'P', 'pickoff lock'],
    'Guinevere':    [2, 2, 3, 0, 1, 1, 3, 1, 0, 1, 1, 'M', 'M', 'dive pickoff engage flex'],
    'Terizla':      [2, 3, 1, 0, 2, 2, 1, 1, 0, 1, 1, 'M', 'P', 'teamfight zone engage'],
    'Thamuz':       [1, 1, 2, 0, 2, 2, 1, 2, 0, 2, 2, 'M', 'P', 'dive frontline flex'],
    'Masha':        [1, 1, 2, 0, 1, 2, 1, 3, 0, 3, 2, 'M', 'P', 'split push'],
    'Khaleed':      [1, 2, 2, 0, 2, 2, 1, 1, 0, 1, 2, 'M', 'P', 'teamfight sustain'],
    'Paquito':      [1, 2, 2, 0, 1, 1, 3, 1, 0, 1, 1, 'E', 'P', 'dive pickoff'],
    'Yu Zhong':     [2, 2, 2, 0, 3, 2, 1, 2, 0, 1, 2, 'M', 'P', 'teamfight dive sustain'],
    'Dyrroth':      [1, 1, 2, 0, 1, 1, 3, 1, 0, 1, 1, 'E', 'P', 'dive pickoff shred'],
    'Jawhead':      [3, 2, 2, 0, 0, 2, 2, 0, 0, 1, 0, 'E', 'P', 'engage pickoff dive flex'],
    'Martis':       [1, 2, 2, 0, 1, 1, 2, 2, 0, 2, 1, 'M', 'P', 'teamfight dive flex'],
    'Silvanna':     [2, 3, 2, 0, 1, 2, 2, 1, 0, 1, 1, 'M', 'M', 'pickoff lock engage'],
    'Yin':          [1, 2, 2, 0, 1, 1, 3, 1, 0, 1, 1, 'E', 'P', 'pickoff lock flex'],
    'Minsitthar':   [2, 3, 2, 0, 0, 2, 1, 1, 0, 1, 1, 'E', 'P', 'antimob engage teamfight flex'],
    'Aulus':        [0, 1, 1, 0, 1, 2, 1, 3, 0, 2, 1, 'L', 'P', 'scale'],
    'Freya':        [1, 1, 2, 0, 1, 2, 1, 3, 0, 2, 1, 'M', 'P', 'dive flex'],
    'Lapu-Lapu':    [1, 2, 2, 0, 2, 2, 2, 2, 0, 1, 2, 'M', 'P', 'teamfight'],
    'Leomord':      [1, 1, 3, 0, 1, 2, 2, 2, 0, 2, 1, 'M', 'P', 'dive flex'],
    'Phoveus':      [2, 1, 3, 0, 1, 2, 2, 1, 0, 1, 1, 'M', 'M', 'antimob dive'],
    'Arlott':       [2, 2, 3, 0, 1, 2, 2, 1, 0, 1, 1, 'E', 'P', 'dive pickoff flex'],
    'Cici':         [1, 1, 3, 1, 2, 2, 1, 2, 1, 1, 2, 'M', 'P', 'teamfight sustain'],
    'Sora':         [1, 1, 2, 0, 1, 2, 2, 2, 0, 1, 1, 'M', 'P', 'dive flex'],                          // review
    'Bane':         [1, 1, 1, 2, 1, 2, 1, 2, 2, 3, 3, 'M', 'X', 'poke push flex'],
    'Lukas':        [2, 2, 2, 0, 3, 2, 1, 2, 0, 1, 2, 'M', 'P', 'frontline sustain teamfight'],
    'Gatotkaca':    [3, 3, 2, 0, 1, 3, 1, 0, 0, 1, 1, 'M', 'M', 'engage teamfight frontline flex'],
    'Roger':        [0, 1, 2, 2, 1, 1, 2, 3, 0, 2, 1, 'M', 'P', 'dive pickoff flex'],
    // ── Assassins ──
    'Saber':        [1, 2, 2, 0, 0, 1, 3, 0, 0, 1, 0, 'E', 'P', 'pickoff lock flex'],
    'Karina':       [0, 0, 2, 0, 1, 1, 3, 2, 0, 2, 1, 'M', 'M', 'teamfight dive'],
    'Fanny':        [0, 0, 3, 0, 0, 1, 3, 1, 0, 2, 1, 'M', 'P', 'dive pickoff'],
    'Hayabusa':     [0, 0, 3, 0, 1, 1, 3, 1, 0, 2, 1, 'M', 'P', 'pickoff split'],
    'Natalia':      [0, 1, 2, 0, 0, 1, 2, 1, 0, 1, 0, 'E', 'P', 'pickoff invis'],
    'Helcurt':      [0, 2, 2, 0, 0, 1, 3, 1, 0, 2, 0, 'E', 'P', 'pickoff global'],
    'Lancelot':     [0, 0, 3, 0, 0, 1, 3, 1, 0, 2, 1, 'E', 'P', 'dive pickoff'],
    'Gusion':       [0, 0, 3, 1, 0, 1, 3, 1, 0, 1, 1, 'M', 'M', 'pickoff flex'],
    'Ling':         [0, 0, 3, 0, 1, 1, 3, 2, 0, 2, 1, 'M', 'P', 'dive pickoff'],
    'Selena':       [1, 3, 1, 2, 0, 1, 2, 0, 1, 1, 1, 'E', 'M', 'pickoff lock flex'],
    'Benedetta':    [1, 2, 3, 0, 1, 1, 2, 2, 0, 1, 1, 'M', 'P', 'split dive flex'],
    'Aamon':        [0, 1, 2, 0, 0, 1, 3, 1, 0, 2, 0, 'M', 'M', 'pickoff invis'],
    'Nolan':        [0, 0, 3, 0, 0, 1, 3, 1, 0, 2, 1, 'E', 'P', 'dive pickoff'],
    'Yi Sun-shin':  [0, 1, 1, 2, 1, 1, 2, 2, 0, 2, 1, 'M', 'P', 'scale global vision flex'],
    'Suyou':        [1, 1, 3, 0, 1, 1, 3, 1, 0, 2, 1, 'E', 'P', 'dive pickoff'],
    'Joy':          [1, 2, 3, 0, 1, 1, 2, 2, 0, 2, 1, 'M', 'M', 'dive'],
    'Julian':       [1, 1, 2, 0, 1, 1, 3, 2, 0, 2, 1, 'M', 'M', 'dive flex'],
    'Hanzo':        [0, 0, 1, 2, 0, 0, 2, 2, 1, 2, 1, 'L', 'P', 'scale poke'],
    // ── Mages ──
    'Nana':         [0, 3, 1, 2, 0, 1, 1, 0, 2, 1, 2, 'E', 'M', 'peel poke flex'],
    'Eudora':       [0, 2, 0, 1, 0, 0, 3, 0, 0, 1, 2, 'E', 'M', 'pickoff'],
    'Aurora':       [1, 3, 0, 2, 0, 1, 3, 0, 1, 1, 2, 'M', 'M', 'pickoff teamfight lock'],
    'Gord':         [0, 1, 0, 3, 0, 0, 1, 2, 2, 1, 2, 'M', 'M', 'poke'],
    'Cyclops':      [0, 2, 1, 1, 0, 1, 2, 2, 0, 2, 1, 'E', 'M', 'pickoff lock flex'],
    'Alice':        [1, 2, 2, 0, 3, 2, 1, 2, 0, 1, 2, 'M', 'M', 'dive teamfight sustain flex'],
    'Harley':       [0, 1, 2, 1, 0, 1, 3, 1, 0, 1, 1, 'M', 'M', 'pickoff flex'],
    'Odette':       [1, 2, 1, 1, 0, 1, 2, 3, 0, 1, 2, 'M', 'M', 'teamfight'],
    'Vexana':       [1, 2, 0, 2, 0, 1, 2, 2, 1, 1, 2, 'M', 'M', 'teamfight zone'],
    'Lunox':        [0, 1, 2, 2, 1, 1, 2, 3, 1, 1, 2, 'L', 'M', 'scale flex'],
    'Kagura':       [0, 2, 2, 2, 0, 1, 3, 1, 1, 1, 2, 'M', 'M', 'pickoff poke'],
    'Lylia':        [0, 1, 2, 2, 0, 1, 1, 2, 2, 1, 3, 'E', 'M', 'poke push'],
    'Cecilion':     [0, 1, 1, 3, 1, 1, 2, 2, 3, 1, 2, 'L', 'M', 'poke scale'],
    'Yve':          [0, 2, 1, 3, 0, 1, 1, 2, 3, 1, 3, 'M', 'M', 'poke zone teamfight'],
    'Valentina':    [1, 2, 2, 2, 1, 1, 2, 1, 1, 1, 2, 'M', 'M', 'teamfight flex'],
    'Xavier':       [0, 2, 0, 3, 0, 1, 2, 1, 3, 1, 2, 'M', 'M', 'poke global'],
    'Pharsa':       [0, 1, 1, 3, 0, 0, 2, 2, 3, 2, 3, 'M', 'M', 'poke teamfight'],
    'Novaria':      [0, 1, 1, 3, 0, 1, 2, 1, 3, 1, 2, 'M', 'M', 'poke vision pickoff'],
    'Luo Yi':       [1, 3, 1, 2, 0, 1, 1, 2, 1, 1, 2, 'M', 'M', 'teamfight global zone'],
    'Zhuxin':       [1, 2, 1, 2, 1, 1, 1, 2, 1, 1, 2, 'M', 'M', 'teamfight zone sustain'],
    'Hirara':       [1, 1, 3, 0, 0, 1, 3, 1, 0, 2, 1, 'M', 'P', 'dive pickoff'],                        // kit: Liquipedia (jungle assassin, invincible window)
    'Faramis':      [0, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 'M', 'M', 'teamfight protect flex'],
    'Kadita':       [2, 3, 2, 1, 0, 1, 3, 0, 0, 1, 2, 'M', 'M', 'engage pickoff flex'],
    'Kimmy':        [0, 1, 2, 2, 0, 1, 1, 3, 2, 2, 2, 'M', 'X', 'poke flex'],
    'Zhask':        [0, 1, 0, 2, 0, 1, 1, 2, 1, 3, 3, 'M', 'M', 'push poke'],
    'Vale':         [1, 3, 1, 2, 0, 1, 2, 1, 1, 1, 2, 'M', 'M', 'teamfight'],
    'Valir':        [0, 2, 1, 2, 0, 1, 1, 2, 2, 1, 2, 'M', 'M', 'peel poke flex'],
    'Harith':       [0, 1, 3, 1, 1, 1, 2, 3, 0, 1, 2, 'M', 'M', 'dive flex'],
    'Zetian':       [1, 3, 1, 2, 1, 1, 2, 2, 1, 1, 2, 'M', 'M', 'teamfight zone'],                      // kit: Liquipedia (mid mage, stun/knock/pull ult)
    // ── Marksmen ──
    'Miya':         [0, 0, 1, 2, 1, 0, 0, 3, 0, 2, 2, 'L', 'P', 'scale'],
    'Layla':        [0, 0, 0, 3, 0, 0, 1, 3, 1, 2, 2, 'L', 'P', 'scale poke'],
    'Moskov':       [0, 1, 2, 2, 1, 1, 1, 3, 0, 2, 2, 'L', 'P', 'scale teamfight'],
    'Clint':        [0, 1, 2, 2, 0, 1, 2, 2, 1, 1, 2, 'E', 'P', 'poke'],
    'Bruno':        [0, 1, 1, 2, 0, 1, 2, 2, 0, 1, 1, 'M', 'P', 'pickoff'],
    'Irithel':      [0, 0, 2, 2, 0, 1, 1, 3, 0, 2, 2, 'M', 'P', 'flex'],
    'Lesley':       [0, 0, 1, 3, 0, 0, 3, 2, 2, 1, 1, 'L', 'P', 'poke pickoff flex'],
    'Hanabi':       [0, 0, 0, 2, 2, 1, 0, 3, 0, 2, 3, 'L', 'P', 'scale'],
    'Claude':       [0, 0, 2, 2, 1, 1, 1, 3, 0, 2, 3, 'L', 'P', 'scale teamfight'],
    'Granger':      [0, 0, 2, 2, 0, 1, 3, 1, 0, 2, 1, 'M', 'P', 'pickoff flex'],
    'Brody':        [0, 1, 1, 2, 0, 1, 2, 2, 0, 1, 1, 'E', 'P', 'pickoff'],
    'Karrie':       [0, 0, 2, 2, 0, 1, 1, 3, 0, 3, 2, 'L', 'X', 'shred scale'],
    'Beatrix':      [0, 0, 1, 3, 0, 1, 3, 2, 2, 2, 2, 'M', 'P', 'poke'],
    'Melissa':      [0, 1, 1, 2, 0, 1, 1, 3, 0, 2, 2, 'L', 'P', 'scale peel'],
    'Natan':        [0, 0, 2, 2, 0, 1, 1, 3, 0, 2, 2, 'L', 'M', 'scale'],
    'Wanwan':       [0, 0, 3, 2, 0, 1, 1, 3, 0, 2, 1, 'L', 'P', 'scale dive'],
    'Ixia':         [0, 1, 1, 2, 2, 1, 1, 3, 0, 2, 3, 'L', 'P', 'teamfight scale sustain'],
    'Obsidia':      [0, 1, 1, 3, 0, 1, 2, 3, 1, 2, 2, 'L', 'P', 'scale'],                               // review
    // ── Support ──
    'Estes':        [0, 1, 0, 2, 3, 1, 0, 0, 0, 1, 1, 'M', 'M', 'protect sustain'],
    'Angela':       [0, 2, 1, 2, 3, 1, 0, 0, 0, 1, 1, 'M', 'M', 'protect global peel'],
    'Rafaela':      [0, 2, 2, 2, 2, 1, 0, 0, 0, 1, 1, 'E', 'M', 'protect peel'],
    'Diggie':       [0, 1, 1, 2, 0, 1, 0, 0, 1, 1, 1, 'M', 'M', 'protect vision peel'],
    'Floryn':       [0, 1, 1, 2, 3, 1, 0, 0, 0, 1, 1, 'M', 'M', 'protect global sustain'],
    'Mathilda':     [2, 1, 3, 1, 1, 1, 1, 0, 0, 1, 1, 'E', 'M', 'engage protect dive'],
    'Kaja':         [2, 3, 2, 0, 1, 2, 1, 0, 0, 1, 1, 'E', 'M', 'pickoff lock engage'],
    'Popol & Kupa': [0, 2, 1, 2, 1, 1, 1, 2, 1, 2, 2, 'E', 'P', 'zone peel flex'],
  };
  const P = {};
  Object.keys(D).forEach(h => {
    const r = D[h], o = {};
    COLS.forEach((c, i) => { o[c] = r[i]; });
    o.tags = new Set(String(o.tags || '').split(/\s+/).filter(Boolean));
    P[h] = o;
  });
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const ALIAS = { popolandkupa: 'Popol & Kupa', popolkupa: 'Popol & Kupa', xborg: 'X.Borg', lapulapu: 'Lapu-Lapu', yisunshin: 'Yi Sun-shin', yss: 'Yi Sun-shin', yuzhong: 'Yu Zhong', luoyi: 'Luo Yi', nathan: 'Natan' };
  const byNorm = {}; Object.keys(P).forEach(h => { byNorm[norm(h)] = h; });
  const HP = {
    COLS, data: D,
    get(h) { const k = P[h] ? h : (byNorm[norm(h)] || ALIAS[norm(h)]); return k ? P[k] : null; },
    has(h, tag) { const p = HP.get(h); return !!(p && p.tags.has(tag)); },
    // A hero with no hand-written row (new release): build one from its Liquipedia kit.
    addFromKit(name, h) {
      if (!name || HP.get(name) || !h) return null;
      const t = h.traits || {}, i = h.info || {}, role = String(i.primaryrole || '') + ' ' + String(i.secondaryrole || '');
      const r = re => re.test(role);
      const o = { en: r(/Tank/) ? 2 : (t.hardCC || []).length >= 2 && t.dashes ? 1 : 0, cc: Math.min(3, Math.round((t.hardCC || []).length + (t.slow ? 0.5 : 0))),
        mob: Math.min(3, t.dashes || 0), rng: r(/Marksman/) ? 3 : r(/Mage/) ? 2 : r(/Support/) ? 1 : 0, sus: t.sustain >= 4 ? 3 : t.sustain >= 2 ? 2 : t.sustain >= 1 ? 1 : 0,
        tank: r(/Tank/) ? 3 : r(/Fighter/) ? 2 : 1, bur: r(/Assassin/) ? 3 : r(/Mage/) ? 2 : t.burst ? 2 : 1, dps: r(/Marksman/) ? 3 : r(/Fighter/) ? 2 : 1,
        poke: r(/Mage|Marksman/) ? 1 : 0, obj: r(/Assassin|Marksman/) ? 2 : 1, wave: r(/Mage|Marksman/) ? 2 : 1, spike: r(/Marksman/) ? 'L' : r(/Assassin|Tank/) ? 'E' : 'M', dmg: t.dmg || 'P' };
      const tags = new Set();
      if (r(/Tank/)) { tags.add('frontline'); tags.add('engage'); }
      if (r(/Assassin/)) { tags.add('dive'); tags.add('pickoff'); }
      if (r(/Marksman/)) tags.add('scale');
      if (r(/Mage/)) tags.add('teamfight');
      if (r(/Support/)) { tags.add('protect'); tags.add('peel'); }
      if (t.invis) tags.add('invis'); if (t.antiheal) tags.add('antiheal'); if ((t.hardCC || []).includes('suppress')) tags.add('lock');
      if (t.trueDmg || t.pctHp) tags.add('shred'); if (t.global) tags.add('global'); if (t.sustain >= 3) tags.add('sustain');
      o.tags = tags; o.fromKit = true;
      P[name] = o; byNorm[norm(name)] = name;
      return o;
    },
  };
  // Profile-based counter rules (MLBB game sense): how much does `a` counter `b`?
  HP.counter = function (a, b) {
    const A = HP.get(a), B2 = HP.get(b); if (!A || !B2) return 0;
    let s = 0;
    if (A.tags.has('antimob') && B2.mob >= 3) s += 1.2;                       // Khufra / Minsitthar / Phoveus vs dashers
    if (A.bur >= 3 && B2.tank <= 1 && B2.mob <= 1) s += 0.8;                   // assassins vs immobile squishies
    if (A.tags.has('shred') && B2.tank >= 3) s += 0.8;                         // tank shredders vs frontline
    if (A.tags.has('antiheal') && B2.sus >= 3) s += 0.8;
    if (A.poke >= 3 && B2.mob <= 1 && B2.rng <= 1) s += 0.6;                   // long poke vs slow melee
    if (A.tags.has('lock') && B2.mob >= 3 && B2.tank <= 1) s += 0.6;            // lockdown catches slippery carries
    if (A.cc >= 3 && B2.tags.has('dive') && B2.tank <= 1) s += 0.4;
    if (A.mob >= 3 && A.bur >= 3 && B2.rng >= 2 && B2.mob <= 1 && B2.tank <= 1) s += 0.6; // divers vs backline
    return s;
  };
  // What a lineup has / lacks (for "comp fix" reasoning)
  HP.comp = function (heroes) {
    const ps = heroes.map(h => HP.get(h)).filter(Boolean), n = ps.length || 1;
    const sum = k => ps.reduce((s, p) => s + (p[k] || 0), 0);
    const phys = ps.filter(p => p.dmg === 'P').length, mag = ps.filter(p => p.dmg === 'M').length, mixed = ps.filter(p => p.dmg === 'X').length;
    return { n: ps.length, en: sum('en'), cc: sum('cc'), mob: sum('mob') / n, rng: sum('rng') / n, sus: sum('sus'), tank: sum('tank'), bur: sum('bur'), dps: sum('dps'), poke: sum('poke'), obj: sum('obj'), wave: sum('wave'),
      phys, mag, mixed, early: ps.filter(p => p.spike === 'E').length, late: ps.filter(p => p.spike === 'L').length,
      frontliners: ps.filter(p => p.tank >= 3 || p.tags.has('frontline')).length, engagers: ps.filter(p => p.en >= 2).length };
  };
  // Needs a candidate would fix for a partial lineup (0..n)
  HP.fixes = function (mine, cand) {
    const c = HP.comp(mine), p = HP.get(cand); if (!p) return 0;
    let f = 0;
    if (c.frontliners === 0 && (p.tank >= 3 || p.tags.has('frontline'))) f++;
    if (c.engagers === 0 && p.en >= 2) f++;
    if (c.n >= 2 && c.mag + c.mixed === 0 && (p.dmg === 'M' || p.dmg === 'X')) f++;
    if (c.n >= 2 && c.phys + c.mixed === 0 && (p.dmg === 'P' || p.dmg === 'X')) f++;
    if (c.n >= 3 && c.cc < 4 && p.cc >= 2) f += 0.5;
    if (c.n >= 3 && c.wave < 5 && p.wave >= 3) f += 0.5;
    return f;
  };
  HP.synergy = function (a, b) {
    const A = HP.get(a), B2 = HP.get(b); if (!A || !B2) return 0;
    let s = 0;
    if (A.en >= 2 && (B2.tags.has('teamfight') || B2.bur >= 3)) s += 0.5;       // engage + follow-up
    if (B2.en >= 2 && (A.tags.has('teamfight') || A.bur >= 3)) s += 0.5;
    if (A.tags.has('protect') && (B2.spike === 'L' && B2.dps >= 3)) s += 0.5;    // protect the carry
    if (B2.tags.has('protect') && (A.spike === 'L' && A.dps >= 3)) s += 0.5;
    if (A.cc >= 3 && B2.bur >= 3) s += 0.3; if (B2.cc >= 3 && A.bur >= 3) s += 0.3;
    return s;
  };
  root.WHeroProfile = HP;
})(typeof window !== 'undefined' ? window : globalThis);
