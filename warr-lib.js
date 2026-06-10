const WARR_CONFIG = {
  supabaseUrl:     window.WARR_SUPABASE_URL  || 'https://nqqlmzdyyhbyvsbybdem.supabase.co',
  supabaseAnonKey: window.WARR_SUPABASE_ANON || 'sb_publishable_14TS_XufXsZnsyw4x2NLAQ_vshJ1KA3',
};

// Initialize Supabase client (requires @supabase/supabase-js CDN)
// Fail loud with a clear message if the CDN script wasn't loaded before this file.
if (!window.supabase || !window.supabase.createClient) {
  const _msg = '[warr-lib] Supabase CDN script missing — include <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script> BEFORE warr-lib.js. WDB/WAuth will not work.';
  console.error(_msg);
  // Don't throw — let the rest of warr-lib.js define stubs so calling code can report the error cleanly
  window.supabase = window.supabase || { createClient: () => ({
    from: () => ({ select: () => Promise.reject(new Error('Supabase CDN not loaded')), insert: () => Promise.reject(new Error('Supabase CDN not loaded')), upsert: () => Promise.reject(new Error('Supabase CDN not loaded')), delete: () => Promise.reject(new Error('Supabase CDN not loaded')), update: () => Promise.reject(new Error('Supabase CDN not loaded')), eq: function(){return this;}, neq: function(){return this;}, order: function(){return this;}, limit: function(){return this;}, single: function(){return this;} }),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }), signInWithPassword: () => Promise.reject(new Error('Supabase CDN not loaded')), signOut: () => Promise.resolve(), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
  })};
}
const _sbClient = window.supabase.createClient(WARR_CONFIG.supabaseUrl, WARR_CONFIG.supabaseAnonKey);

// ═══════════════════════════════════════════════════════════════
// AUTH HELPERS
// ═══════════════════════════════════════════════════════════════
const WAuth = {
  _user:    null,
  _profile: null,

  // Expose the raw Supabase client for auth.html invite flow
  _sb() { return _sbClient; },

  async init() {
    const { data: { user } } = await _sbClient.auth.getUser();
    this._user = user;
    if (user) {
      const { data } = await _sbClient.from('profiles').select('*').eq('id', user.id).single();
      this._profile = data || null;
    }
    return user;
  },

  getUser()    { return this._user; },
  getProfile() { return this._profile; },
  isLoggedIn() { return !!this._user; },

  /** Returns display name → team name → email prefix, whichever exists */
  getDisplayName() {
    if (this._profile?.display_name) return this._profile.display_name;
    if (this._profile?.team_name)    return this._profile.team_name;
    return this._user?.email?.split('@')[0] || 'User';
  },

  async signIn(email, password) {
    const { data, error } = await _sbClient.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      this._user = data.user;
      const { data: prof } = await _sbClient.from('profiles').select('*').eq('id', data.user.id).single();
      this._profile = prof || null;
    }
    return { data, error };
  },

  /** Full profile save — syncs all fields to Supabase profiles table */
  async saveProfile(fields = {}) {
    const user = this._user || (await _sbClient.auth.getUser()).data.user;
    if (!user) return { error: { message: 'Not authenticated' } };

    // Support old signature: saveProfile(displayName, teamName)
    if (typeof fields === 'string') {
      const displayName = fields;
      const teamName = arguments[1];
      fields = { display_name: displayName };
      if (teamName) fields.team_name = teamName;
    }

    const payload = {
      id:    user.id,
      email: user.email,
      ...fields,
    };

    // If setting a team, determine team_status
    if (fields.team_name !== undefined) {
      const MPL_TEAMS = ['Blacklist International','ECHO','Nexplay EVOS','ONIC Philippines',
        'AP Bren','RSG Philippines','Omega Esports','TeamHigh',
        'Team HAQ','Todak','DRX MY','Geek Fam','Team SMG','ONIC MY'];
      const isMPL = MPL_TEAMS.includes(fields.team_name);
      // Only set pending if it's currently none/rejected; keep approved if already approved
      if (isMPL && fields.team_name) {
        const currentStatus = this._profile?.team_status || 'none';
        if (currentStatus !== 'approved') payload.team_status = 'pending';
      } else if (!fields.team_name) {
        payload.team_status = 'none';
      } else {
        payload.team_status = 'none'; // custom non-MPL team, no approval needed
      }
    }

    const { error } = await _sbClient.from('profiles').upsert(payload, { onConflict: 'id' });
    if (!error) this._profile = { ...this._profile, ...payload };
    return { error };
  },

  /** Admin-only: update any user's profile fields */
  async adminUpdateProfile(userId, fields = {}) {
    if (!WAdmin.isAdmin()) return { error: { message: 'Admin only' } };
    const { data, error } = await _sbClient
      .from('profiles')
      .update(fields)
      .eq('id', userId)
      .select()
      .single();
    return { data, error };
  },

  /** Admin-only: get all profiles (paginated) */
  async adminGetAllProfiles(page = 0, pageSize = 50) {
    if (!WAdmin.isAdmin()) return { data: [], error: { message: 'Admin only' } };
    const from = page * pageSize;
    const { data, error, count } = await _sbClient
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    return { data: data || [], error, count };
  },

  /** Admin-only: get pending team requests */
  async adminGetPendingRequests() {
    if (!WAdmin.isAdmin()) return { data: [] };
    const { data, error } = await _sbClient
      .from('profiles')
      .select('*')
      .eq('team_status', 'pending')
      .order('updated_at', { ascending: true });
    return { data: data || [], error };
  },

  /** Admin-only: soft-ban a user (sets is_banned=true, they can't use the app) */
  async adminBanUser(userId, ban = true) {
    return this.adminUpdateProfile(userId, { is_banned: ban });
  },

  /** Admin-only: hard-delete a user's PROFILE row (auth user stays until SQL deletion) */
  async adminDeleteProfile(userId) {
    if (!WAdmin.isAdmin()) return { error: { message: 'Admin only' } };
    const { error } = await _sbClient.from('profiles').delete().eq('id', userId);
    return { error };
  },

  async signOut() {
    await _sbClient.auth.signOut();
    this._user    = null;
    this._profile = null;
  },

  onAuthChange(callback) {
    return _sbClient.auth.onAuthStateChange(async (event, session) => {
      this._user = session?.user || null;
      if (this._user) {
        const { data } = await _sbClient.from('profiles').select('*').eq('id', this._user.id).single();
        this._profile = data || null;
      } else {
        this._profile = null;
      }
      callback(event, session);
    });
  },

  /** Redirects to auth.html if not signed in. Call at top of every protected page.
   *  Preserves intended destination via ?redirect= param. */
  async requireAuth() {
    await this.init();
    if (!this._user) {
      const dest = encodeURIComponent(location.pathname.split('/').pop() + location.search);
      window.location.href = 'auth.html' + (dest ? '?redirect=' + dest : '');
      return false;
    }
    return true;
  },

  /** Renders the user chip in the top nav. Pass the container element id. */
  async renderAuthChip(containerId = 'authChip') {
    // init() is a no-op if already called
    if (!this._user) await this.init();
    const el = document.getElementById(containerId);
    if (!el) return;
    if (this._user) {
      const name     = this.getDisplayName();
      const teamTag  = this._profile?.team_name ? `<span class="wauth-team">${this._profile.team_name}</span>` : '';
      el.innerHTML = `
        <div class="wauth-chip">
          <div class="wauth-dot"></div>
          <span class="wauth-name" title="${this._user.email}">${name}</span>
          ${teamTag}
          <button class="wauth-out" onclick="WAuth.signOut().then(()=>location.href='auth.html')">Sign Out</button>
        </div>`;
    } else {
      el.innerHTML = `<a href="auth.html" class="wauth-signin">Sign In</a>`;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// DATABASE HELPERS  (jsonb storage — simple & flexible)
// ═══════════════════════════════════════════════════════════════
//
// SQL to run once in Supabase → SQL Editor:
//
//   -- Scout matches: shared across ALL authenticated users
//   CREATE TABLE public.scout_matches (
//     id          text PRIMARY KEY,          -- match's local id e.g. 'match_1234'
//     created_at  timestamptz DEFAULT now(),
//     updated_at  timestamptz DEFAULT now(),
//     created_by  uuid REFERENCES auth.users(id),
//     data        jsonb NOT NULL
//   );
//   ALTER TABLE public.scout_matches ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "All users read" ON public.scout_matches FOR SELECT USING (auth.role()='authenticated');
//   CREATE POLICY "All users insert" ON public.scout_matches FOR INSERT WITH CHECK (auth.role()='authenticated');
//   CREATE POLICY "Creator updates" ON public.scout_matches FOR UPDATE USING (auth.uid()=created_by OR created_by IS NULL);
//   CREATE POLICY "Creator deletes" ON public.scout_matches FOR DELETE USING (auth.uid()=created_by OR created_by IS NULL);
//
//   -- Draft saves: private per user account
//   CREATE TABLE public.draft_saves (
//     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id     uuid REFERENCES auth.users(id) NOT NULL,
//     created_at  timestamptz DEFAULT now(),
//     name        text NOT NULL DEFAULT 'Draft',
//     data        jsonb NOT NULL
//   );
//   ALTER TABLE public.draft_saves ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Own drafts only" ON public.draft_saves FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
//
// ─────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
// ── ADMIN SYSTEM ──
// Only the designated admin email can add/delete official competition data.
// Leagues marked as ADMIN_LOCKED require admin auth for write operations.
// ═══════════════════════════════════════════════════════════════
window.WAdmin = {
  ADMIN_EMAIL: 'wrrenvillapando@gmail.com',

  // Leagues that require admin auth to write/delete
  LOCKED_LEAGUES: ['MPL PH','MPL MY','MPL ID','MPL SG','MPL KH','MSC','M-Series'],

  // Check if the currently signed-in user is the admin
  isAdmin() {
    const user = (typeof WAuth !== 'undefined' && WAuth.getUser) ? WAuth.getUser() : null;
    if (user && user.email === WAdmin.ADMIN_EMAIL) return true;
    // Also check localStorage profile (for offline use)
    try {
      const profile = JSON.parse(localStorage.getItem('warr_user_profile') || '{}');
      return profile.email === WAdmin.ADMIN_EMAIL;
    } catch(e) { return false; }
  },

  // Returns true if this match is from a locked league
  isLockedMatch(match) {
    const league = (match && (match.league || (match.data && match.data.league))) || '';
    return WAdmin.LOCKED_LEAGUES.includes(league);
  },

  // Guard: returns true if the operation is allowed, false + shows error if not
  canWrite(league) {
    if (!WAdmin.LOCKED_LEAGUES.includes(league)) return true; // non-official league, anyone can write
    if (WAdmin.isAdmin()) return true;
    return false;
  },

  canDelete(match) {
    if (!WAdmin.isLockedMatch(match)) return true;
    if (WAdmin.isAdmin()) return true;
    return false;
  },
};

const WDB = {

  // ── SCOUT MATCHES — public leagues shared; Scrims/Other private to creator ─────

  // Leagues visible to ALL users
  PUBLIC_LEAGUES: ['MPL PH','MPL MY','MPL ID','MPL SG','MPL KH','MSC','M-Series'],

  // Cross-page cache backed by sessionStorage so that navigating between
  // pages (which are full page reloads in this app) doesn't refetch the
  // entire match library each time. TTL is 5 min — saveMatch / deleteMatch
  // invalidate the cache immediately so your own edits never go stale.
  _MATCH_CACHE_KEY: 'warr_loadmatches_cache_v2',
  _matchCacheTTL: 5 * 60_000,
  _invalidateMatchCache() {
    try { sessionStorage.removeItem(this._MATCH_CACHE_KEY); } catch(e) {}
  },
  _readMatchCache() {
    try {
      const raw = sessionStorage.getItem(this._MATCH_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      if ((Date.now() - (obj.t||0)) > this._matchCacheTTL) return null;
      // Rebind to current user — RLS already filters server-side, but the
      // public/own filter runs client-side and changes per session.
      const userId = WAuth.getUser()?.id || null;
      if (obj.uid !== userId) return null;
      return obj.matches;
    } catch(e) { return null; }
  },
  _writeMatchCache(matches) {
    try {
      const userId = WAuth.getUser()?.id || null;
      sessionStorage.setItem(this._MATCH_CACHE_KEY, JSON.stringify({
        t: Date.now(), uid: userId, matches,
      }));
    } catch(e) {
      // sessionStorage quota — give up silently, in-memory load still works.
      console.warn('match cache write failed:', e?.message);
    }
  },

  /** Fetch scout matches — public leagues for everyone, private leagues only own.
   *  Uses a sessionStorage cache (5 min TTL, invalidated on save/delete) so
   *  repeat page navigations are instant. Pass {force:true} to skip the cache. */
  async loadMatches(opts) {
    if (!opts?.force) {
      const cached = this._readMatchCache();
      if (cached) return cached;
    }
    const { data, error } = await _sbClient
      .from('scout_matches')
      .select('id, data, created_by')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const userId = WAuth.getUser()?.id || null;
    const result = (data || [])
      .filter(row => {
        const league = row.data?.league || '';
        const isPublic = WDB.PUBLIC_LEAGUES.includes(league);
        const isOwn = row.created_by === userId;
        return isPublic || isOwn;
      })
      .map(row => ({ ...row.data, id: row.id, _createdBy: row.created_by }));
    this._writeMatchCache(result);
    return result;
  },

  /** Upsert a single match to cloud (insert or update by id) */
  async saveMatch(match) {
    const user = WAuth.getUser();
    const { error } = await _sbClient
      .from('scout_matches')
      .upsert(
        { id: match.id, data: match, created_by: user?.id || null },
        { onConflict: 'id' }
      );
    if (error) throw error;
    this._invalidateMatchCache();
  },

  /** Delete a match from cloud */
  async deleteMatch(id) {
    const { error } = await _sbClient.from('scout_matches').delete().eq('id', id);
    if (error) throw error;
    this._invalidateMatchCache();
  },

  // ── DRAFT SAVES — private, per user account ──────────────────

  /** Save current draft state with a name. Returns { id, name, created_at }. */
  async saveDraft(name, draftData) {
    const user = WAuth.getUser();
    if (!user) throw new Error('Sign in to save drafts');
    const { data, error } = await _sbClient
      .from('draft_saves')
      .insert({ user_id: user.id, name: name || 'Draft', data: draftData })
      .select('id, name, created_at')
      .single();
    if (error) throw error;
    return data;
  },

  /** Load this user's saved drafts (newest first, max 30) */
  async loadDrafts() {
    const user = WAuth.getUser();
    if (!user) return [];
    const { data, error } = await _sbClient
      .from('draft_saves')
      .select('id, name, created_at, data')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return data || [];
  },

  /** Delete one of the user's saved drafts */
  async deleteDraft(id) {
    const { error } = await _sbClient.from('draft_saves').delete().eq('id', id);
    if (error) throw error;
  },

  /**
   * Compute hero → primary lane from scout match data.
   * Returns { heroName: 'Gold'|'Jungle'|'Mid'|'EXP'|'Roam' }
   * Only includes heroes with >= minSamples observations to avoid noise.
   */
  async computeHeroRoles(minSamples = 2) {
    let matches;
    try { matches = await this.loadMatches(); } catch(e) { return {}; }
    const counts = {}; // { heroName: { Gold: n, Jungle: n, ... } }
    matches.forEach(m => {
      [...(m.bluePicks || []), ...(m.redPicks || [])].forEach(p => {
        if (!p || !p.name || !p.lane) return;
        if (!counts[p.name]) counts[p.name] = {};
        counts[p.name][p.lane] = (counts[p.name][p.lane] || 0) + 1;
      });
    });
    const result = {};
    Object.entries(counts).forEach(([hero, laneCounts]) => {
      const total = Object.values(laneCounts).reduce((a,b) => a+b, 0);
      if (total < minSamples) return;
      const sorted = Object.entries(laneCounts).sort((a,b) => b[1]-a[1]);
      result[hero] = sorted[0][0]; // most common lane
    });
    return result;
  },
};

// ═══════════════════════════════════════════════════════════════
// MIGRATION HELPER
// Exports existing localStorage data to import into Supabase
// Call once from the browser console: WMigrate.exportToJSON()
// ═══════════════════════════════════════════════════════════════
const WMigrate = {
  exportToJSON() {
    const keys = ['warr_scout_db', 'warr_draft_history', 'warr_patch_meta'];
    const out = {};
    keys.forEach(k => {
      try { out[k] = JSON.parse(localStorage.getItem(k) || 'null'); } catch(e) {}
    });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'warr_migration_export.json';
    a.click();
    console.log('✅ Exported. Upload this file to Supabase via the import tool.');
  },

  /** Import JSON from exportToJSON() into Supabase (uses new scout_matches table) */
  async importFromJSON(jsonData) {
    const db = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    const matches = db['warr_scout_db']?.matches || db['wgg_matches'] || [];
    if (!matches.length) { console.warn('No matches found in export'); return; }

    let ok = 0, fail = 0;
    for (const m of matches) {
      try {
        await WDB.saveMatch(m);
        ok++;
      } catch(e) {
        console.error('Failed to import match', m.id, e.message);
        fail++;
      }
    }
    console.log(`✅ Migration complete: ${ok} matches uploaded, ${fail} failed`);
  }
};

// ═══════════════════════════════════════════════════════════════
// TOAST UTILITY (shared)
// ═══════════════════════════════════════════════════════════════
// ── DYNAMIC TIER SYSTEM (from scout data) ──
// Computes S/A/B/C tiers based on actual pick/ban rates observed in scout data
// Call this on page load to override hardcoded tiers
window.WDB = window.WDB || {};
WDB.computeDynamicTiers = function(minGames = 3) {
  try {
    const raw = localStorage.getItem('warr_scout_data');
    if (!raw) return null;
    const db = JSON.parse(raw);
    if (!db.matches || db.matches.length < minGames) return null;

    const totalGames = db.matches.length;
    const heroStats = {};

    db.matches.forEach(m => {
      const allPicks = [...(m.bluePicks || []), ...(m.redPicks || [])];
      const allBans = [...(m.blueBans || []), ...(m.redBans || [])];
      const winner = m.winner; // 'blue' or 'red'

      // Count picks
      allPicks.forEach(p => {
        const name = typeof p === 'string' ? p : p?.name;
        if (!name) return;
        if (!heroStats[name]) heroStats[name] = { picks: 0, bans: 0, wins: 0, games: 0 };
        heroStats[name].picks++;
        heroStats[name].games++;

        // Track wins: check which side this pick was on
        const isBlue = (m.bluePicks || []).some(bp => (typeof bp === 'string' ? bp : bp?.name) === name);
        if ((isBlue && winner === 'blue') || (!isBlue && winner === 'red')) {
          heroStats[name].wins++;
        }
      });

      // Count bans
      allBans.forEach(b => {
        const name = typeof b === 'string' ? b : b?.name;
        if (!name) return;
        if (!heroStats[name]) heroStats[name] = { picks: 0, bans: 0, wins: 0, games: 0 };
        heroStats[name].bans++;
      });
    });

    // Compute rates and assign tiers
    const result = {};
    Object.entries(heroStats).forEach(([name, stats]) => {
      // Tier is based on PICK rate + win rate only — bans are denial/fear, not pick strength.
      // A hero banned 10 games but never picked (denial target) should stay C-tier.
      const pickRate = (stats.picks / totalGames) * 100;
      const banRate  = (stats.bans  / totalGames) * 100;
      const presence = ((stats.picks + stats.bans) / totalGames) * 100; // kept for mp calc
      const winRate = stats.picks > 0 ? (stats.wins / stats.picks) * 100 : 0;

      // Tier assignment: pick rate + win rate only
      // S-tier: >40% pick rate OR (>20% pick rate AND >58% WR)
      // A-tier: >20% pick rate OR (>10% pick rate AND >54% WR)
      // B-tier: >5% pick rate
      // C-tier: everything else (includes denial bans that are rarely/never picked)
      let tier = 'C';
      if (pickRate >= 40 || (pickRate >= 20 && winRate >= 58)) tier = 'S';
      else if (pickRate >= 20 || (pickRate >= 10 && winRate >= 54)) tier = 'A';
      else if (pickRate >= 5) tier = 'B';

      // Meta priority uses presence (picks+bans) — high ban rate still means "pay attention"
      let mp = 'off';
      if (presence >= 80) mp = 'mustban';
      else if (presence >= 50) mp = 'highpick';
      else if (presence >= 15) mp = 'situational';

      result[name] = {
        tier, mp, presence: Math.round(presence * 10) / 10,
        winRate: Math.round(winRate * 10) / 10,
        picks: stats.picks, bans: stats.bans, games: stats.games
      };
    });

    return result;
  } catch (e) {
    console.warn('computeDynamicTiers error:', e);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════
// ── SCOUT-DERIVED COUNTER SYSTEM ──
// Builds a counter map purely from match data win/loss patterns.
// Returns { heroName: [{name, wr, count}] } — heroes that beat heroName
// ═══════════════════════════════════════════════════════════════
WDB.computeScoutCounters = function(minWR, minMatches) {
  minWR = minWR === undefined ? 0.60 : minWR;
  minMatches = minMatches === undefined ? 2 : minMatches;
  try {
    const raw = localStorage.getItem('warr_scout_data');
    if (!raw) return {};
    const db = JSON.parse(raw);
    if (!db.matches || !db.matches.length) return {};

    const vsRecord = {};
    db.matches.forEach(function(mx) {
      const winner = mx.winner;
      if (!winner) return;
      const bluePicks = (mx.bluePicks || []).map(function(p){ return p.name || p; }).filter(Boolean);
      const redPicks  = (mx.redPicks  || []).map(function(p){ return p.name || p; }).filter(Boolean);
      const winPicks  = winner === 'blue' ? bluePicks : redPicks;
      const losePicks = winner === 'blue' ? redPicks  : bluePicks;
      winPicks.forEach(function(wHero) {
        if (!vsRecord[wHero]) vsRecord[wHero] = {};
        losePicks.forEach(function(lHero) {
          if (!vsRecord[wHero][lHero]) vsRecord[wHero][lHero] = { wins: 0, count: 0 };
          vsRecord[wHero][lHero].wins++;
          vsRecord[wHero][lHero].count++;
        });
      });
      losePicks.forEach(function(lHero) {
        if (!vsRecord[lHero]) vsRecord[lHero] = {};
        winPicks.forEach(function(wHero) {
          if (!vsRecord[lHero][wHero]) vsRecord[lHero][wHero] = { wins: 0, count: 0 };
          vsRecord[lHero][wHero].count++;
        });
      });
    });

    const result = {};
    Object.keys(vsRecord).forEach(function(hero) {
      Object.keys(vsRecord[hero]).forEach(function(opp) {
        const stats = vsRecord[hero][opp];
        if (stats.count < minMatches) return;
        const wr = stats.wins / stats.count;
        if (wr >= minWR) {
          if (!result[opp]) result[opp] = [];
          result[opp].push({ name: hero, wr: Math.round(wr * 100) / 100, count: stats.count });
        }
      });
    });
    Object.keys(result).forEach(function(hero) {
      result[hero].sort(function(a, b) { return b.wr - a.wr; });
    });
    return result;
  } catch (e) {
    console.warn('computeScoutCounters error:', e);
    return {};
  }
};

WDB._counterCache = null;
WDB._counterCacheKey = null;
WDB.getCounterMap = function() {
  const cacheKey = (localStorage.getItem('warr_scout_data') || '').length;
  if (WDB._counterCache && WDB._counterCacheKey === cacheKey) return WDB._counterCache;
  WDB._counterCache = WDB.computeScoutCounters();
  WDB._counterCacheKey = cacheKey;
  return WDB._counterCache;
};

// ═══════════════════════════════════════════════════════════════
// ── HERO RELATIONS (Supabase-driven counters + synergies) ──
// Powers the Heroes page. Two sources are blended:
//
//   1. Computed from scout_matches (public MPL/MSC/M-Series only,
//      Scrims are excluded automatically because loadMatches()
//      filters by PUBLIC_LEAGUES for non-owners, and we drop
//      private leagues here too).
//
//   2. Admin overrides stored in the `hero_relations` table.
//      If an override exists for a given (hero, type) it REPLACES
//      the computed set for that hero so admin curation always wins.
//
// Per hero we expose up to 3 counters and 3 best-with (synergies).
// ═══════════════════════════════════════════════════════════════

/** For each hero → list of opposing picks that beat them most often.
 *  vs[H][X] tracks H's record against X (wins + total games). Returned
 *  rows show the *counter's* win rate vs H (i.e. 1 - H's wr), sorted desc.
 *  [{ name, wr, count }]   (min 2 games, wr = counter's wr against H) */
WDB.computeScoutCountersFromMatches = function(matches, minMatches, opts) {
  // Default raised from 2 → 3: two-game samples were producing noisy "100% counter" entries.
  // Three games is still permissive but cuts the worst coin-flip noise.
  minMatches = minMatches == null ? 3 : minMatches;
  // opts.includeAll: when true, also count scrims / private leagues. Used by AI Battle +
  // Draft Board so the coach's own scrim intel feeds the AI's reasoning. Default false
  // preserves the original public-only behavior for the Heroes page.
  const includeAll = !!(opts && opts.includeAll);
  const vs = {}; // vs[H][X] = { wins: H's wins vs X, count: total games together }
  (matches || []).forEach(m => {
    if (!m || !m.winner) return;
    const league = m.league || '';
    if (!includeAll && !WDB.PUBLIC_LEAGUES.includes(league)) return; // skip Scrims / Other
    const blue = (m.bluePicks || []).map(p => p && (p.name || p)).filter(Boolean);
    const red  = (m.redPicks  || []).map(p => p && (p.name || p)).filter(Boolean);
    const winPicks  = m.winner === 'blue' ? blue : red;
    const losePicks = m.winner === 'blue' ? red  : blue;
    // Winning side: each H on win side has a win against each X on lose side
    winPicks.forEach(H => {
      if (!vs[H]) vs[H] = {};
      losePicks.forEach(X => {
        if (H === X) return;
        if (!vs[H][X]) vs[H][X] = { wins: 0, count: 0 };
        vs[H][X].wins  += 1;
        vs[H][X].count += 1;
      });
    });
    // Losing side: each H on lose side has a loss against each X on win side
    losePicks.forEach(H => {
      if (!vs[H]) vs[H] = {};
      winPicks.forEach(X => {
        if (H === X) return;
        if (!vs[H][X]) vs[H][X] = { wins: 0, count: 0 };
        vs[H][X].count += 1; // no win added
      });
    });
  });
  const out = {};
  Object.keys(vs).forEach(H => {
    // Counters of H = opponents who beat H most → highest counter wr
    const rows = Object.entries(vs[H])
      .filter(([_, s]) => s.count >= minMatches)
      .map(([name, s]) => ({
        name,
        wr: 1 - (s.wins / s.count), // counter's win rate against H
        count: s.count
      }))
      .sort((a, b) => (b.wr - a.wr) || (b.count - a.count));
    out[H] = rows;
  });
  return out;
};

/** For each hero → list of same-team heroes with best win rate together.
 *  [{ name, wr, count }]   (sorted by wr desc, min 2 games) */
WDB.computeScoutSynergiesFromMatches = function(matches, minMatches, opts) {
  // Default raised from 2 → 3 (see counters function above).
  minMatches = minMatches == null ? 3 : minMatches;
  const includeAll = !!(opts && opts.includeAll);
  const pair = {}; // pair[hero][mate] = { wins, count }
  (matches || []).forEach(m => {
    if (!m || !m.winner) return;
    const league = m.league || '';
    if (!includeAll && !WDB.PUBLIC_LEAGUES.includes(league)) return;
    ['blue', 'red'].forEach(side => {
      const picks = (m[side + 'Picks'] || []).map(p => p && (p.name || p)).filter(Boolean);
      const won   = m.winner === side;
      for (let i = 0; i < picks.length; i++) {
        for (let j = 0; j < picks.length; j++) {
          if (i === j) continue;
          const a = picks[i], b = picks[j];
          if (!pair[a]) pair[a] = {};
          if (!pair[a][b]) pair[a][b] = { wins: 0, count: 0 };
          pair[a][b].count += 1;
          if (won) pair[a][b].wins += 1;
        }
      }
    });
  });
  const out = {};
  Object.keys(pair).forEach(hero => {
    const rows = Object.entries(pair[hero])
      .filter(([_, s]) => s.count >= minMatches)
      .map(([name, s]) => ({ name, wr: s.wins / s.count, count: s.count }))
      .sort((a, b) => (b.wr - a.wr) || (b.count - a.count));
    out[hero] = rows;
  });
  return out;
};

/** For each hero, the heroes that opponents most often DRAFT when this hero
 *  is on the enemy team. Cross-pair count from bluePicks × redPicks across all
 *  matches, with win-rate of the RESPONSE hero.
 *
 *  Returns: { [hero]: [ { name, count, wr }, ... ] } sorted by count desc.
 *  - count: games where `name` was drafted while `hero` was on enemy
 *  - wr:    0..1 win rate of the RESPONSE (chip hero) in those games. So when
 *           shown on `hero`'s card, high wr means this response actually worked.
 *  Only includes opposing-side pairs with at least minMatches games. */
WDB.computeDraftedAgainstFromMatches = function(matches, minMatches, opts) {
  minMatches = minMatches == null ? 3 : minMatches;
  const includeAll = !!(opts && opts.includeAll);
  const map = {}; // map[hero][response] = { count, wins }  (wins = response's wins)
  (matches || []).forEach(m => {
    if (!m || !m.winner) return;
    const league = m.league || '';
    if (!includeAll && !WDB.PUBLIC_LEAGUES.includes(league)) return; // skip scrims / private
    const blue = (m.bluePicks || []).map(p => p && (p.name || p)).filter(Boolean);
    const red  = (m.redPicks  || []).map(p => p && (p.name || p)).filter(Boolean);
    const blueWon = m.winner === 'blue';
    blue.forEach(bh => {
      red.forEach(rh => {
        // From bh's card POV: rh is the response. rh is on red side, so rh
        // won iff red won.
        if (!map[bh]) map[bh] = {};
        if (!map[bh][rh]) map[bh][rh] = { count: 0, wins: 0 };
        map[bh][rh].count++;
        if (!blueWon) map[bh][rh].wins++;
        // From rh's card POV: bh is the response. bh is on blue side, so bh
        // won iff blue won.
        if (!map[rh]) map[rh] = {};
        if (!map[rh][bh]) map[rh][bh] = { count: 0, wins: 0 };
        map[rh][bh].count++;
        if (blueWon) map[rh][bh].wins++;
      });
    });
  });
  const out = {};
  Object.entries(map).forEach(([hero, responses]) => {
    out[hero] = Object.entries(responses)
      .filter(([_, s]) => s.count >= minMatches)
      .map(([name, s]) => ({ name, count: s.count, wr: s.count ? s.wins / s.count : 0 }))
      .sort((a, b) => b.count - a.count);
  });
  return out;
};

/** Lane-aware counters: vs[H][L][X][L2] tracks H-in-L vs X-in-L2.
 *  Returns nested map: { [hero]: { [heroLane]: { [counter]: { [counterLane]: {wr, count} } } } }
 *  Use case: Pharsa-Mid counters ≠ Pharsa-EXP counters. Lookup is
 *  WDB.getLaneAwareCounter(map, heroName, heroLane, candidateName, candidateLane).
 *  Falls back to global counter when sample is too thin (caller's job). */
WDB.computeLaneAwareCountersFromMatches = function(matches, minMatches, opts) {
  minMatches = minMatches == null ? 2 : minMatches;
  const includeAll = !!(opts && opts.includeAll);
  const vs = {};
  (matches || []).forEach(m => {
    if (!m || !m.winner) return;
    const league = m.league || '';
    if (!includeAll && !WDB.PUBLIC_LEAGUES.includes(league)) return;
    const blue = (m.bluePicks || []).map(p => p && {name:p.name||p, lane:p.lane||null}).filter(p=>p&&p.name);
    const red  = (m.redPicks  || []).map(p => p && {name:p.name||p, lane:p.lane||null}).filter(p=>p&&p.name);
    const winSide = m.winner === 'blue' ? blue : red;
    const loseSide= m.winner === 'blue' ? red  : blue;
    // From the WIN side's POV, every winner has a win against every loser
    winSide.forEach(H => {
      if (!H.lane) return;
      loseSide.forEach(X => {
        if (!X.lane || H.name === X.name) return;
        if (!vs[H.name]) vs[H.name] = {};
        if (!vs[H.name][H.lane]) vs[H.name][H.lane] = {};
        if (!vs[H.name][H.lane][X.name]) vs[H.name][H.lane][X.name] = {};
        const cell = vs[H.name][H.lane][X.name][X.lane] || { wins: 0, count: 0 };
        cell.wins += 1; cell.count += 1;
        vs[H.name][H.lane][X.name][X.lane] = cell;
      });
    });
    // From the LOSE side's POV, just count (no win)
    loseSide.forEach(H => {
      if (!H.lane) return;
      winSide.forEach(X => {
        if (!X.lane || H.name === X.name) return;
        if (!vs[H.name]) vs[H.name] = {};
        if (!vs[H.name][H.lane]) vs[H.name][H.lane] = {};
        if (!vs[H.name][H.lane][X.name]) vs[H.name][H.lane][X.name] = {};
        const cell = vs[H.name][H.lane][X.name][X.lane] || { wins: 0, count: 0 };
        cell.count += 1;
        vs[H.name][H.lane][X.name][X.lane] = cell;
      });
    });
  });
  // Normalize: at each (H, hl, X, xl) cell, X's WR against H = 1 - (H's wins / count)
  const out = {};
  Object.keys(vs).forEach(H => {
    out[H] = {};
    Object.keys(vs[H]).forEach(hl => {
      out[H][hl] = {};
      Object.keys(vs[H][hl]).forEach(X => {
        Object.keys(vs[H][hl][X]).forEach(xl => {
          const cell = vs[H][hl][X][xl];
          if (cell.count < minMatches) return;
          if (!out[H][hl][X]) out[H][hl][X] = {};
          out[H][hl][X][xl] = { wr: 1 - (cell.wins / cell.count), count: cell.count };
        });
      });
    });
  });
  return out;
};

/** Quick lookup: X-in-xl's WR against H-in-hl. Returns null when no data. */
WDB.getLaneAwareCounter = function(map, heroName, heroLane, candidateName, candidateLane) {
  try {
    return map && map[heroName] && map[heroName][heroLane]
      && map[heroName][heroLane][candidateName]
      && map[heroName][heroLane][candidateName][candidateLane] || null;
  } catch (_) { return null; }
};

/** Composition identity detector.
 *  Returns { identity, confidence, scores } where identity ∈
 *  {dive, poke, teamfight, pickoff, scale} or null when too few picks.
 *  scores: { dive: 0..1, poke: 0..1, ... } — softmax-ish over archetype fit.
 *  Identity locks at confidence >= 0.55. */
WDB.COMP_ARCHETYPES = {
  dive:      { heroes: ['Ling','Lancelot','Hayabusa','Gusion','Chou','Jawhead','Khufra','Zilong','Paquito','Benedetta','Aamon','Julian','Arlott','Karina','Helcurt','Saber','Roger','Yu Zhong','Fanny','Nolan'], roles:{Assassin:3,Fighter:2,Tank:1} },
  poke:      { heroes: ['Pharsa','Lunox','Selena','Beatrix','Lesley','Natan','Yve','Valir','Harith','Novaria','Cyclops','Aurora','Chang\'e','Kimmy','Layla','Bruno','Granger','Karrie'], roles:{Mage:3,Marksman:2,MM:2,Support:1} },
  teamfight: { heroes: ['Atlas','Tigreal','Vale','Kagura','Wanwan','Ruby','Gatotkaca','Carmilla','Floryn','Estes','Grock','Belerick','Johnson','Khufra','Lolita','Faramis','Minsitthar','Phoveus','Edith'], roles:{Tank:3,Mage:2,Support:2} },
  pickoff:   { heroes: ['Chou','Franco','Kaja','Natalia','Selena','Saber','Hanzo','Fanny','Akai','Mathilda','Diggie','Helcurt','Benedetta','Cecilion','Ling','Lancelot','Nolan'], roles:{Assassin:2,Support:2,Tank:2} },
  scale:     { heroes: ['Karrie','Wanwan','Esmeralda','Uranus','Diggie','Angela','Hylos','Estes','Yi Sun-shin','Melissa','Moskov','Bruno','Granger','Beatrix','Brody','Edith'], roles:{Marksman:3,MM:3,Tank:2,Support:2} },
};

WDB.detectComposition = function(picks) {
  if (!picks || picks.length < 2) {
    return { identity: null, confidence: 0, scores: {} };
  }
  const scores = {};
  // Lazy role helper — accepts {name, role} or hero objects either way.
  const roleOf = p => (p && (p.role || p.heroRole) || '').split('/')[0].trim();
  Object.entries(WDB.COMP_ARCHETYPES).forEach(([k, def]) => {
    let s = 0;
    picks.forEach(p => {
      const n = p.name || p;
      if (def.heroes.includes(n)) s += 2;
      const r = roleOf(p);
      if (r && def.roles[r]) s += (def.roles[r] / 3); // 0.33..1.0
    });
    scores[k] = s / Math.max(picks.length * 2, 4);
  });
  // Pick the dominant archetype
  let identity = null, best = 0;
  Object.entries(scores).forEach(([k, v]) => { if (v > best) { best = v; identity = k; } });
  // Need both an absolute threshold and a margin over the runner-up
  const sorted = Object.values(scores).sort((a,b)=>b-a);
  const margin = sorted[0] - (sorted[1] || 0);
  const confident = best >= 0.40 && margin >= 0.10;
  return {
    identity: confident ? identity : null,
    confidence: best,
    scores
  };
};

/** Score how well a candidate hero fits a given composition identity.
 *  Returns 0..1. Used by coach engines to bias toward identity coherence. */
WDB.compFitScore = function(heroName, role, identity) {
  if (!identity || !WDB.COMP_ARCHETYPES[identity]) return 0;
  const def = WDB.COMP_ARCHETYPES[identity];
  let s = 0;
  if (def.heroes.includes(heroName)) s += 0.6;
  const r = (role || '').split('/')[0].trim();
  if (r && def.roles[r]) s += (def.roles[r] / 3) * 0.4;
  return Math.min(s, 1);
};

/** Load all admin-curated hero_relations. Returns:
 *    { [hero]: { counter: [names], synergy: [names] } }  */
WDB.loadHeroRelations = async function() {
  if (typeof _sbClient === 'undefined') return {};
  try {
    const { data, error } = await _sbClient
      .from('hero_relations')
      .select('hero, type, related_hero, slot')
      .order('slot', { ascending: true });
    if (error) throw error;
    const out = {};
    (data || []).forEach(r => {
      if (!out[r.hero]) out[r.hero] = { counter: [], synergy: [] };
      if (r.type === 'counter' || r.type === 'synergy') {
        out[r.hero][r.type].push(r.related_hero);
      }
    });
    return out;
  } catch (e) {
    console.warn('[WDB] loadHeroRelations failed:', e.message);
    return {};
  }
};

/** Replace the stored list for (hero, type) with the given heroes array.
 *  Deletes any existing slot rows for that pair, then inserts up to 3 new.
 *  Admin only — RLS will reject non-admin writes. */
WDB.saveHeroRelation = async function(hero, type, heroes) {
  if (typeof _sbClient === 'undefined') throw new Error('Supabase not ready');
  if (type !== 'counter' && type !== 'synergy') throw new Error('type must be counter or synergy');
  const list = (Array.isArray(heroes) ? heroes : []).filter(Boolean).slice(0, 3);

  // Delete existing rows for this (hero, type)
  const delRes = await _sbClient
    .from('hero_relations')
    .delete()
    .eq('hero', hero)
    .eq('type', type);
  if (delRes.error) throw delRes.error;

  if (!list.length) return { inserted: 0 };

  const user = (typeof WAuth !== 'undefined' && WAuth.getUser) ? WAuth.getUser() : null;
  const rows = list.map((related_hero, slot) => ({
    hero, type, related_hero, slot, created_by: user?.id || null
  }));
  const { error } = await _sbClient.from('hero_relations').insert(rows);
  if (error) throw error;
  return { inserted: rows.length };
};

// ═══════════════════════════════════════════════════════════════
// ── SUBSCRIPTION / TOKEN SYSTEM ──
// 3-tier: free (10 tokens/mo) / pro (50/mo) / team (200/mo)
// ═══════════════════════════════════════════════════════════════
WDB.PLANS = {
  free:  { label: 'Free',  tokensPerMonth: 10,  price: 0     },
  pro:   { label: 'Pro',   tokensPerMonth: 50,  price: 9.99  },
  team:  { label: 'Team',  tokensPerMonth: 200, price: 29.99 },
};

WDB.getSubscription = function() {
  try {
    const raw = localStorage.getItem('warr_subscription');
    if (!raw) return { plan: 'free', tokensUsed: 0, resetDate: null };
    const sub = JSON.parse(raw);
    if (sub.resetDate) {
      const now = new Date();
      if (now >= new Date(sub.resetDate)) {
        sub.tokensUsed = 0;
        sub.resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
        localStorage.setItem('warr_subscription', JSON.stringify(sub));
      }
    }
    return sub;
  } catch (e) { return { plan: 'free', tokensUsed: 0, resetDate: null }; }
};

WDB.saveSubscription = function(sub) {
  if (!sub.resetDate) {
    const now = new Date();
    sub.resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }
  localStorage.setItem('warr_subscription', JSON.stringify(sub));
};

WDB.getTokensRemaining = function() {
  const sub = WDB.getSubscription();
  const plan = WDB.PLANS[sub.plan] || WDB.PLANS.free;
  return Math.max(0, plan.tokensPerMonth - (sub.tokensUsed || 0));
};

WDB.consumeToken = function() {
  const sub = WDB.getSubscription();
  const plan = WDB.PLANS[sub.plan] || WDB.PLANS.free;
  if ((sub.tokensUsed || 0) >= plan.tokensPerMonth) return false;
  sub.tokensUsed = (sub.tokensUsed || 0) + 1;
  WDB.saveSubscription(sub);
  return true;
};

WDB.canAnalyze = function() {
  return WDB.getTokensRemaining() > 0;
};

// ═══════════════════════════════════════════════════════════════
// HERO ROSTER (compact — used by profile picker & pool helpers)
// ═══════════════════════════════════════════════════════════════
WDB.HERO_ROSTER = [
  {n:'Tigreal',r:'Tank'},
  {n:'Akai',r:'Tank'},
  {n:'Franco',r:'Tank'},
  {n:'Minotaur',r:'Tank'},
  {n:'Lolita',r:'Tank'},
  {n:'Johnson',r:'Tank'},
  {n:'Atlas',r:'Tank'},
  {n:'Khufra',r:'Tank'},
  {n:'Esmeralda',r:'Tank/Mage'},
  {n:'Uranus',r:'Tank'},
  {n:'Hylos',r:'Tank'},
  {n:'Belerick',r:'Tank'},
  {n:'Grock',r:'Tank'},
  {n:'Carmilla',r:'Tank'},
  {n:'Baxia',r:'Tank'},
  {n:'Gloo',r:'Tank'},
  {n:'Chip',r:'Tank'},
  {n:'Fredrinn',r:'Tank/Fighter'},
  {n:'Kalea',r:'Tank'},
  {n:'Edith',r:'Tank/MM'},
  {n:'Marcel',r:'Tank'},
  {n:'Barats',r:'Fighter/Tank'},
  {n:'Balmond',r:'Fighter'},
  {n:'Zilong',r:'Fighter'},
  {n:'Alucard',r:'Fighter'},
  {n:'Alpha',r:'Fighter'},
  {n:'Sun',r:'Fighter'},
  {n:'Argus',r:'Fighter'},
  {n:'Hilda',r:'Fighter'},
  {n:'Ruby',r:'Fighter'},
  {n:'X.Borg',r:'Fighter'},
  {n:'Aldous',r:'Fighter'},
  {n:'Chou',r:'Fighter'},
  {n:'Badang',r:'Fighter'},
  {n:'Guinevere',r:'Fighter'},
  {n:'Terizla',r:'Fighter'},
  {n:'Thamuz',r:'Fighter'},
  {n:'Masha',r:'Fighter'},
  {n:'Khaleed',r:'Fighter'},
  {n:'Paquito',r:'Fighter'},
  {n:'Yu Zhong',r:'Fighter'},
  {n:'Dyrroth',r:'Fighter'},
  {n:'Jawhead',r:'Fighter'},
  {n:'Martis',r:'Fighter'},
  {n:'Silvanna',r:'Fighter'},
  {n:'Yin',r:'Fighter'},
  {n:'Minsitthar',r:'Fighter'},
  {n:'Aulus',r:'Fighter'},
  {n:'Freya',r:'Fighter'},
  {n:'Lapu-Lapu',r:'Fighter'},
  {n:'Leomord',r:'Fighter'},
  {n:'Phoveus',r:'Fighter'},
  {n:'Arlott',r:'Fighter'},
  {n:'Cici',r:'Fighter'},
  {n:'Sora',r:'Fighter/Assassin'},
  {n:'Bane',r:'Fighter'},
  {n:'Lukas',r:'Fighter'},
  {n:'Gatotkaca',r:'Tank/Fighter'},
  {n:'Roger',r:'Fighter/MM'},
  {n:'Saber',r:'Assassin'},
  {n:'Karina',r:'Assassin'},
  {n:'Fanny',r:'Assassin'},
  {n:'Hayabusa',r:'Assassin'},
  {n:'Natalia',r:'Assassin'},
  {n:'Helcurt',r:'Assassin'},
  {n:'Lancelot',r:'Assassin'},
  {n:'Gusion',r:'Assassin'},
  {n:'Ling',r:'Assassin'},
  {n:'Selena',r:'Assassin/Mage'},
  {n:'Benedetta',r:'Assassin'},
  {n:'Aamon',r:'Assassin'},
  {n:'Nolan',r:'Assassin'},
  {n:'Yi Sun-shin',r:'Assassin/MM'},
  {n:'Suyou',r:'Assassin'},
  {n:'Joy',r:'Assassin'},
  {n:'Julian',r:'Fighter/Assassin'},
  {n:'Hanzo',r:'Assassin'},
  {n:'Nana',r:'Mage/Support'},
  {n:'Eudora',r:'Mage'},
  {n:'Aurora',r:'Mage'},
  {n:'Gord',r:'Mage'},
  {n:'Cyclops',r:'Mage'},
  {n:'Alice',r:'Mage/Tank'},
  {n:'Harley',r:'Mage/Assassin'},
  {n:'Odette',r:'Mage'},
  {n:'Vexana',r:'Mage'},
  {n:'Lunox',r:'Mage'},
  {n:'Kagura',r:'Mage'},
  {n:'Lylia',r:'Mage'},
  {n:'Cecilion',r:'Mage'},
  {n:'Yve',r:'Mage'},
  {n:'Valentina',r:'Mage'},
  {n:'Xavier',r:'Mage'},
  {n:'Pharsa',r:'Mage'},
  {n:'Novaria',r:'Mage'},
  {n:'Luo Yi',r:'Mage'},
  {n:'Zhuxin',r:'Mage'},
  {n:'Faramis',r:'Mage/Support'},
  {n:'Kadita',r:'Mage/Assassin'},
  {n:'Kimmy',r:'Mage/MM'},
  {n:'Zhask',r:'Mage'},
  {n:'Vale',r:'Mage'},
  {n:'Valir',r:'Mage'},
  {n:'Harith',r:'Mage'},
  {n:'Zetian',r:'Mage'},
  {n:'Miya',r:'MM'},
  {n:'Layla',r:'MM'},
  {n:'Moskov',r:'MM'},
  {n:'Clint',r:'MM'},
  {n:'Bruno',r:'MM'},
  {n:'Irithel',r:'MM'},
  {n:'Lesley',r:'MM/Assassin'},
  {n:'Hanabi',r:'MM'},
  {n:'Claude',r:'MM'},
  {n:'Granger',r:'MM'},
  {n:'Brody',r:'MM'},
  {n:'Karrie',r:'MM'},
  {n:'Beatrix',r:'MM'},
  {n:'Melissa',r:'MM'},
  {n:'Natan',r:'MM'},
  {n:'Wanwan',r:'MM'},
  {n:'Ixia',r:'MM'},
  {n:'Obsidia',r:'MM'},
  {n:'Estes',r:'Support'},
  {n:'Angela',r:'Support'},
  {n:'Rafaela',r:'Support'},
  {n:'Diggie',r:'Support'},
  {n:'Floryn',r:'Support'},
  {n:'Mathilda',r:'Support'},
  {n:'Kaja',r:'Support/Fighter'},
  {n:'Popol & Kupa',r:'Support/MM'}
];

// ── Portrait filename aliases (hero name → actual .png basename) ──
WDB.PORTRAIT_ALIAS = {
  'Yi Sun-shin': 'YSS',
  'Popol & Kupa': 'Popol',
  'Lapu-Lapu':   'LapuLapu',
  'X.Borg':      'Xborg',
  'Yu Zhong':    'YuZhong',
  'Luo Yi':      'luoyi',
};
// ── Portrait override system (cloud-backed, with VARIANTS) ──
// Each hero can have multiple uploaded portrait VARIANTS so the admin can
// use different aesthetics on different surfaces:
//   • 'icon'     → square 1:1, for small thumbs in pickers / stats tables
//   • 'portrait' → 3:4 / 4:5 taller crop, for big aesthetic cards on the
//                  homepage Meta Hierarchies grid and Heroes detail cards
//
// Cloud override resolution (in WDB.heroPortrait):
//   1. requested variant cloud override (e.g. 'portrait')
//   2. fallback to 'icon' cloud override (so a card always shows SOMETHING
//      reasonable even if the portrait variant isn't uploaded yet)
//   3. local PNG in portraits/<HeroName>.png (the existing 132 files)
//
// Storage layout in the bucket:
//   hero-portraits/icon/<HeroOrAlias>.png
//   hero-portraits/portrait/<HeroOrAlias>.png
WDB.PORTRAIT_VARIANTS = ['icon', 'portrait'];
WDB._portraitOverrides = {};   // {heroName: {variant: publicUrl}}
WDB._portraitOverridesLoaded = false;

/** Load the override map once per session. Safe to call multiple times. */
WDB.loadHeroPortraitOverrides = async function() {
  if (WDB._portraitOverridesLoaded) return WDB._portraitOverrides;
  if (typeof _sbClient === 'undefined') return {};
  try {
    // After migration 002, hero_portrait_overrides has a 'variant' column.
    // We try selecting it; if the column doesn't exist (migration 002 not
    // applied yet) we fall back to treating every row as the 'icon' variant.
    let rows = [];
    try {
      const { data, error } = await _sbClient
        .from('hero_portrait_overrides')
        .select('hero_name, variant, file_path, updated_at');
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      // Older schema without variant column
      const { data, error } = await _sbClient
        .from('hero_portrait_overrides')
        .select('hero_name, file_path, updated_at');
      if (error) throw error;
      rows = (data || []).map(r => ({ ...r, variant: 'icon' }));
    }

    const map = {};
    rows.forEach(row => {
      const { data: pub } = _sbClient.storage
        .from('hero-portraits')
        .getPublicUrl(row.file_path);
      const stamp = row.updated_at ? `?t=${new Date(row.updated_at).getTime()}` : '';
      const url = (pub?.publicUrl || '') + stamp;
      const variant = row.variant || 'icon';
      if (!map[row.hero_name]) map[row.hero_name] = {};
      map[row.hero_name][variant] = url;
    });
    WDB._portraitOverrides = map;
    WDB._portraitOverridesLoaded = true;
    return map;
  } catch (e) {
    console.warn('[WDB] loadHeroPortraitOverrides failed:', e.message);
    return {};
  }
};

/** Upload a new portrait for a hero. Admin only.
 *  @param {string} heroName  — e.g. 'Aamon'
 *  @param {File}   file      — image File from <input type="file">
 *  @param {string} variant   — 'icon' | 'portrait' (default 'icon')
 *  Returns { url } on success or throws. */
WDB.uploadHeroPortrait = async function(heroName, file, variant) {
  if (!heroName || !file) throw new Error('heroName and file are required');
  if (typeof _sbClient === 'undefined') throw new Error('Supabase not initialized');
  if (typeof WAdmin === 'undefined' || !WAdmin.isAdmin()) throw new Error('Admin only');
  variant = WDB.PORTRAIT_VARIANTS.includes(variant) ? variant : 'icon';

  // Filename: <variant>/<alias-or-name>.<ext>. Using a subpath per variant
  // keeps the bucket organized and means the icon + portrait of the same hero
  // can coexist as distinct objects.
  const base = WDB.PORTRAIT_ALIAS[heroName] || heroName;
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${variant}/${base}.${ext}`;

  const { error: upErr } = await _sbClient.storage
    .from('hero-portraits')
    .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type });
  if (upErr) throw upErr;

  const { error: dbErr } = await _sbClient
    .from('hero_portrait_overrides')
    .upsert({
      hero_name: heroName,
      variant,
      file_path: path,
      updated_at: new Date().toISOString(),
      updated_by: (typeof WAuth !== 'undefined' && WAuth.getUser) ? (WAuth.getUser()?.id || null) : null
    }, { onConflict: 'hero_name,variant' });
  if (dbErr) {
    // Friendlier error when migration 002 hasn't been run yet.
    const msg = (dbErr.message || '').toLowerCase();
    if (msg.includes("'variant'") || msg.includes('variant')) {
      throw new Error("Database needs an upgrade — run migrations/002_hero_portrait_variants.sql in Supabase Studio → SQL Editor, then try again. (Schema is missing the 'variant' column.)");
    }
    throw dbErr;
  }

  // Refresh local cache with the new cache-busted URL
  const { data: pub } = _sbClient.storage.from('hero-portraits').getPublicUrl(path);
  const url = (pub?.publicUrl || '') + `?t=${Date.now()}`;
  if (!WDB._portraitOverrides[heroName]) WDB._portraitOverrides[heroName] = {};
  WDB._portraitOverrides[heroName][variant] = url;
  return { url };
};

/** Remove a single variant of a hero's portrait override (reverts to fallback).
 *  Admin only. */
WDB.deleteHeroPortrait = async function(heroName, variant) {
  if (!heroName) throw new Error('heroName is required');
  if (typeof _sbClient === 'undefined') throw new Error('Supabase not initialized');
  if (typeof WAdmin === 'undefined' || !WAdmin.isAdmin()) throw new Error('Admin only');
  variant = WDB.PORTRAIT_VARIANTS.includes(variant) ? variant : 'icon';

  // Find the existing path so we can clean up the storage object too.
  const { data: row } = await _sbClient
    .from('hero_portrait_overrides')
    .select('file_path')
    .eq('hero_name', heroName)
    .eq('variant', variant)
    .maybeSingle();
  if (row?.file_path) {
    await _sbClient.storage.from('hero-portraits').remove([row.file_path]).catch(() => {});
  }
  await _sbClient.from('hero_portrait_overrides')
    .delete()
    .eq('hero_name', heroName)
    .eq('variant', variant);
  if (WDB._portraitOverrides[heroName]) {
    delete WDB._portraitOverrides[heroName][variant];
    if (!Object.keys(WDB._portraitOverrides[heroName]).length) {
      delete WDB._portraitOverrides[heroName];
    }
  }
};

// ── Homepage hero-banner slides (cloud-synced) ──
// Single-row table keyed 'default' that holds the entire slides array as
// JSONB. WDB.loadHomepageSlides() pulls them on the homepage; the editor
// in profile.html calls WDB.saveHomepageSlides() and also mirrors to
// localStorage as an offline fallback.

WDB.loadHomepageSlides = async function() {
  if (typeof _sbClient === 'undefined') return null;
  try {
    const { data, error } = await _sbClient
      .from('homepage_slides')
      .select('slides, updated_at')
      .eq('id', 'default')
      .maybeSingle();
    if (error) throw error;
    if (data && Array.isArray(data.slides) && data.slides.length) return data.slides;
    return null;
  } catch (e) {
    console.warn('[WDB] loadHomepageSlides failed:', e.message);
    return null;
  }
};

WDB.saveHomepageSlides = async function(slides) {
  if (!Array.isArray(slides) || !slides.length) throw new Error('slides must be a non-empty array');
  if (typeof _sbClient === 'undefined') throw new Error('Supabase not initialized');
  if (typeof WAdmin === 'undefined' || !WAdmin.isAdmin()) throw new Error('Admin only');
  const { error } = await _sbClient
    .from('homepage_slides')
    .upsert({
      id: 'default',
      slides,
      updated_at: new Date().toISOString(),
      updated_by: (typeof WAuth !== 'undefined' && WAuth.getUser) ? (WAuth.getUser()?.id || null) : null
    }, { onConflict: 'id' });
  if (error) throw error;
};

/** Upload a homepage hero-banner slide background image. Admin only.
 *  Stored in the existing hero-portraits bucket under a slides/ prefix
 *  so we don't need another bucket / RLS setup. Returns { url }.
 *  Filename is timestamped so re-uploads don't collide. */
WDB.uploadSlideBackground = async function(file) {
  if (!file) throw new Error('file is required');
  if (typeof _sbClient === 'undefined') throw new Error('Supabase not initialized');
  if (typeof WAdmin === 'undefined' || !WAdmin.isAdmin()) throw new Error('Admin only');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const safeBase = (file.name.replace(/\.[^.]+$/, '') || 'slide')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'slide';
  const path = `slides/${Date.now()}-${safeBase}.${ext}`;

  const { error: upErr } = await _sbClient.storage
    .from('hero-portraits')
    .upload(path, file, { upsert: false, cacheControl: '3600', contentType: file.type });
  if (upErr) throw upErr;

  const { data: pub } = _sbClient.storage.from('hero-portraits').getPublicUrl(path);
  return { url: pub?.publicUrl || '' };
};

/** Returns the best portrait URL for a hero + variant.
 *  Fallback chain:
 *    1. requested variant cloud override
 *    2. 'icon' cloud override (so portrait cards aren't blank if not uploaded)
 *    3. local portraits/<Name>.png (the existing 132 files)
 *  @param {string} name     — hero name, e.g. 'Aamon'
 *  @param {string} variant  — 'icon' (default) | 'portrait' */
WDB.heroPortrait = function(name, variant) {
  variant = WDB.PORTRAIT_VARIANTS.includes(variant) ? variant : 'icon';
  const overrides = WDB._portraitOverrides && WDB._portraitOverrides[name];
  if (overrides) {
    if (overrides[variant]) return overrides[variant];
    if (variant !== 'icon' && overrides.icon) return overrides.icon;
  }
  const base = WDB.PORTRAIT_ALIAS[name] || name;
  return `portraits/${base}.png`;
};

// ── Hero Pool helpers ──
/** Get saved hero pool (array of hero names) */
WDB.getHeroPool = function() {
  try {
    // Prefer Supabase profile if available
    const sbPool = (typeof WAuth !== 'undefined' && WAuth.getProfile)
      ? WAuth.getProfile()?.hero_pool : null;
    if (Array.isArray(sbPool) && sbPool.length > 0) return sbPool;
    return JSON.parse(localStorage.getItem('warr_hero_pool') || '[]');
  } catch(e) { return []; }
};

/** Save hero pool locally + sync to Supabase */
WDB.saveHeroPool = async function(heroes) {
  const arr = Array.isArray(heroes) ? heroes : [];
  localStorage.setItem('warr_hero_pool', JSON.stringify(arr));
  if (typeof WAuth !== 'undefined' && WAuth.isLoggedIn && WAuth.isLoggedIn()) {
    try { await WAuth.saveProfile({ hero_pool: arr }); } catch(e) {}
  }
};

/** Check if a hero name is in the user's pool */
WDB.isInPool = function(heroName) {
  return WDB.getHeroPool().includes(heroName);
};

/** Get pool heroes filtered to a given role keyword (e.g. 'Assassin') */
WDB.getPoolByRole = function(roleKw) {
  const pool = WDB.getHeroPool();
  if (!roleKw) return pool;
  return pool.filter(n => {
    const h = WDB.HERO_ROSTER.find(x => x.n === n);
    return h && h.r.includes(roleKw);
  });
};

// ═══════════════════════════════════════════════════════════════
// HERO LANE DEFAULTS (single source of truth shared across pages)
// ───────────────────────────────────────────────────────────────
// Static lane mapping based on real MLBB role usage. Used as fallback
// when scout match data has no observation for a hero. Heroes with
// scout-observed lanes always take precedence over these defaults.
// ═══════════════════════════════════════════════════════════════
WDB.HERO_LANE_DEFAULTS = {
  // Gold
  'Claude':['Gold'],'Karrie':['Gold'],'Beatrix':['Gold'],'Wanwan':['Gold'],
  'Granger':['Gold'],'Brody':['Gold'],'Miya':['Gold'],'Bruno':['Gold'],
  'Clint':['Gold'],'Hanabi':['Gold'],'Irithel':['Gold'],'Layla':['Gold'],
  'Lesley':['Gold'],'Melissa':['Gold'],'Moskov':['Gold'],'Natan':['Gold'],
  'Ixia':['Gold'],'Obsidia':['Gold'],
  'Roger':['Gold','Jungle'],'Freya':['Gold'],'Harith':['Gold'],
  // Jungle
  'Yi Sun-shin':['Jungle'],'Hayabusa':['Jungle'],'Lancelot':['Jungle'],
  'Ling':['Jungle'],'Fanny':['Jungle'],'Nolan':['Jungle'],'Gusion':['Jungle'],
  'Karina':['Jungle'],'Benedetta':['Jungle'],'Helcurt':['Jungle'],
  'Joy':['Jungle'],'Aamon':['Jungle'],'Natalia':['Jungle'],'Saber':['Jungle'],
  'Hanzo':['Jungle'],'Suyou':['Jungle'],'Fredrinn':['Jungle','EXP'],
  'Phoveus':['EXP'],'Martis':['Jungle','EXP'],
  'Aldous':['EXP','Jungle'],'Argus':['EXP','Jungle'],'Barats':['Jungle','EXP'],
  'Leomord':['Jungle'],'Alpha':['Jungle'],'Harley':['Jungle','Mid'],
  'Julian':['Jungle','Mid'],'Balmond':['EXP'],
  'Sun':['EXP','Jungle'],'Baxia':['Roam','Jungle'],
  // Mid
  'Alice':['Mid','Roam'],
  'Zhuxin':['Mid'],'Yve':['Mid'],'Pharsa':['Mid'],'Kagura':['Mid'],'Zetian':['Mid'],
  'Valentina':['Mid'],'Xavier':['Mid'],'Novaria':['Mid'],'Lylia':['Mid'],
  'Lunox':['Mid'],'Kadita':['Mid','Jungle'],'Luo Yi':['Mid'],'Odette':['Mid'],
  'Cecilion':['Mid'],'Vale':['Mid'],'Eudora':['Mid'],'Aurora':['Mid'],
  'Gord':['Mid'],'Cyclops':['Mid'],'Vexana':['Mid'],'Zhask':['Mid'],
  'Nana':['Mid','Roam'],'Kimmy':['Mid'],"Chang'e":['Mid'],
  'Selena':['Mid','Roam'],'Faramis':['Roam','Mid'],'Valir':['Mid','Roam'],
  // EXP
  'Aulus':['EXP'],'Guinevere':['Jungle'],
  'Yu Zhong':['EXP'],'Arlott':['EXP'],'Cici':['EXP'],'Gatotkaca':['EXP'],
  'Esmeralda':['EXP'],'Dyrroth':['EXP'],'Terizla':['EXP'],'Thamuz':['EXP'],
  'Khaleed':['EXP'],'Paquito':['EXP'],'Silvanna':['EXP'],
  'Badang':['EXP'],'Ruby':['EXP','Roam'],
  'Hilda':['EXP','Roam'],'Masha':['EXP'],'X.Borg':['EXP'],
  'Lapu-Lapu':['EXP'],'Zilong':['EXP'],'Alucard':['EXP'],'Yin':['EXP'],
  'Lukas':['EXP','Jungle'],'Sora':['EXP'],'Bane':['EXP'],
  'Jawhead':['Roam'],'Uranus':['EXP'],'Minsitthar':['Roam','EXP'],
  // Roam
  'Hylos':['Roam'],'Atlas':['Roam'],'Khufra':['Roam'],
  'Gloo':['Roam'],'Chip':['Roam'],'Kalea':['Roam'],'Mathilda':['Roam'],
  'Angela':['Roam'],'Floryn':['Roam'],'Franco':['Roam'],'Tigreal':['Roam'],
  'Johnson':['Roam'],'Akai':['Roam'],'Minotaur':['Roam'],'Lolita':['Roam'],
  'Grock':['Roam'],'Belerick':['Roam'],'Carmilla':['Roam'],
  'Kaja':['Roam'],'Diggie':['Roam'],'Estes':['Roam'],'Rafaela':['Roam'],
  'Edith':['Roam'],'Marcel':['Roam'],'Chou':['Roam','Gold'],
  'Popol & Kupa':['Roam'],
};

/** Return the array of likely lanes for a hero. Looks up the hardcoded map first;
 *  falls back to a role-based heuristic for any hero not in the map. Always returns
 *  at least one lane label (or ['Flex'] if role doesn't disambiguate). */
WDB.getHeroLanes = function(name, role) {
  if (WDB.HERO_LANE_DEFAULTS[name]) return WDB.HERO_LANE_DEFAULTS[name];
  const r = role || '';
  if (r.includes('Support')) return ['Roam'];
  if (r.startsWith('MM') || r === 'MM') return ['Gold'];
  if (r.includes('Assassin') && !r.includes('Fighter')) return ['Jungle'];
  if (r.includes('Mage') && !r.includes('Support')) return ['Mid'];
  if (r.includes('Tank') && !r.includes('Fighter')) return ['Roam'];
  if (r.includes('Fighter')) return ['EXP'];
  return ['Flex'];
};

/** Bulk backfill: scan all matches and tag picks with the team's main player
 *  at each lane (when player.role matches pick.lane). Empty tags only — never
 *  overwrites manually set values. Returns { matchesUpdated, picksTagged }. */
WDB.backfillPlayersFromRoster = async function() {
  const players = await WDB.loadPlayers();
  // Group active players by team_name + role for fast lookup
  const rosterByTeam = {};
  players.filter(p => p.is_active !== false).forEach(p => {
    if (!p.team_name || !p.role) return;
    if (!rosterByTeam[p.team_name]) rosterByTeam[p.team_name] = {};
    // Highest-priority player per (team, role) wins — first hit (loadPlayers
    // already returns by created_at desc, so most recent main is preferred).
    if (!rosterByTeam[p.team_name][p.role]) rosterByTeam[p.team_name][p.role] = p.ign;
  });

  const matches = await WDB.loadMatches();
  let matchesUpdated = 0;
  let picksTagged = 0;
  const dirty = [];
  matches.forEach(m => {
    let changed = false;
    const tagSide = (picks, teamName) => {
      if (!Array.isArray(picks) || !teamName) return;
      const roster = rosterByTeam[teamName];
      if (!roster) return;
      picks.forEach(p => {
        if (!p || p.player) return; // skip if already tagged (manual override preserved)
        if (!p.lane) return;
        const ign = roster[p.lane];
        if (ign) { p.player = ign; picksTagged++; changed = true; }
      });
    };
    tagSide(m.bluePicks, m.blueTeam);
    tagSide(m.redPicks,  m.redTeam);
    if (changed) { matchesUpdated++; dirty.push(m); }
  });

  // Push every changed match back to Supabase. Sequential to keep row order.
  for (const m of dirty) {
    try { await WDB.saveMatch(m); } catch(e) { console.warn('backfill save failed', m.id, e); }
  }
  return { matchesUpdated, picksTagged };
};

/** Compute hero → ALL observed lanes from scout data, ordered by frequency.
 *  Returns { heroName: ['PrimaryLane', 'SecondaryLane', ...] }.
 *  Multi-lane heroes get multiple entries; single-lane heroes get a one-element array. */
WDB.computeHeroLaneSets = async function(minSamples = 2) {
  let matches;
  try { matches = await WDB.loadMatches(); } catch(e) { return {}; }
  const counts = {};
  matches.forEach(m => {
    [...(m.bluePicks || []), ...(m.redPicks || [])].forEach(p => {
      if (!p || !p.name || !p.lane) return;
      if (!counts[p.name]) counts[p.name] = {};
      counts[p.name][p.lane] = (counts[p.name][p.lane] || 0) + 1;
    });
  });
  const result = {};
  Object.entries(counts).forEach(([hero, laneCounts]) => {
    const total = Object.values(laneCounts).reduce((a,b) => a+b, 0);
    if (total < minSamples) return;
    result[hero] = Object.entries(laneCounts).sort((a,b) => b[1]-a[1]).map(([l]) => l);
  });
  return result;
};

// ═══════════════════════════════════════════════════════════════
// ADMIN HELPERS
// ═══════════════════════════════════════════════════════════════
/** Check if a given email should have admin access (only wrrenvillapando@gmail.com by default).
 *  A secondary admin list is stored in warr_extra_admins localStorage so the primary admin
 *  can grant access to others without a code deploy. */
WAdmin._getExtraAdmins = function() {
  try { return JSON.parse(localStorage.getItem('warr_extra_admins') || '[]'); } catch(e) { return []; }
};
WAdmin._setExtraAdmins = async function(list) {
  localStorage.setItem('warr_extra_admins', JSON.stringify(list));
  try {
    await _sbClient
      .from('site_config')
      .upsert({ key: 'extra_admins', value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch(e) {
    console.warn('[WAdmin] Could not persist extra_admins to Supabase:', e.message);
  }
};
/** Fetch extra_admins from Supabase and cache locally — call before isAdmin() check on protected pages */
WAdmin.loadExtraAdmins = async function() {
  try {
    const { data } = await _sbClient
      .from('site_config')
      .select('value')
      .eq('key', 'extra_admins')
      .single();
    if (data?.value) {
      localStorage.setItem('warr_extra_admins', data.value);
    }
  } catch(e) { /* table may not exist yet — fall through */ }
};
/** Override isAdmin to also check extra admin list */
(function() {
  const _orig = WAdmin.isAdmin.bind(WAdmin);
  WAdmin.isAdmin = function() {
    if (_orig()) return true;
    const email = (typeof WAuth !== 'undefined' && WAuth.getUser)
      ? WAuth.getUser()?.email : null;
    if (!email) return false;
    return WAdmin._getExtraAdmins().includes(email.toLowerCase());
  };
})();

// ═══════════════════════════════════════════════════════════════
// ADMIN API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════════
/**
 * Simple XOR obfuscation — stops the key being stored in plaintext.
 * Not cryptographic; just prevents casual inspection.
 */
(function() {
  const _SALT = 'w4rr.gg|dr4ft|k3y';
  function _xor(str) {
    return str.split('').map((c, i) =>
      String.fromCharCode(c.charCodeAt(0) ^ _SALT.charCodeAt(i % _SALT.length))
    ).join('');
  }
  function _enc(str) { return btoa(_xor(str)); }
  function _dec(str) { try { return _xor(atob(str)); } catch(e) { return ''; } }

  /**
   * Admin only: save the API key to Supabase site_config table
   * AND cache locally. Call from admin.html.
   */
  WDB.setAdminApiKey = async function(rawKey) {
    if (!WAdmin.isAdmin()) throw new Error('Admin only');
    const obf = _enc(rawKey);
    localStorage.setItem('warr_admin_api_key', obf);
    try {
      const { error } = await _sbClient
        .from('site_config')
        .upsert({ key: 'api_key', value: obf, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error;
    } catch(e) {
      console.warn('[WDB] Supabase site_config write failed — key stored locally only:', e.message);
    }
  };

  /**
   * Get the active API key. Priority:
   *  1. Supabase site_config (admin-set, shared across all users)
   *  2. localStorage cache (warr_admin_api_key)
   *  3. Legacy personal key (warr_api_key — admin only)
   */
  WDB.getAdminApiKey = async function() {
    try {
      const { data } = await _sbClient
        .from('site_config')
        .select('value')
        .eq('key', 'api_key')
        .single();
      if (data?.value) {
        localStorage.setItem('warr_admin_api_key', data.value);
        return _dec(data.value);
      }
    } catch(e) { /* table may not exist yet — fall through */ }

    const cached = localStorage.getItem('warr_admin_api_key');
    if (cached) return _dec(cached);

    if (WAdmin.isAdmin()) {
      const legacy = localStorage.getItem('warr_api_key');
      if (legacy) return legacy;
    }
    return '';
  };

  /** Synchronous version using only local cache */
  WDB.getAdminApiKeySync = function() {
    const cached = localStorage.getItem('warr_admin_api_key');
    if (cached) return _dec(cached);
    if (WAdmin.isAdmin()) return localStorage.getItem('warr_api_key') || '';
    return '';
  };

  /** Remove the admin API key everywhere */
  WDB.clearAdminApiKey = async function() {
    if (!WAdmin.isAdmin()) throw new Error('Admin only');
    localStorage.removeItem('warr_admin_api_key');
    localStorage.removeItem('warr_api_key');
    try { await _sbClient.from('site_config').delete().eq('key', 'api_key'); } catch(e) {}
  };
})();

// ═══════════════════════════════════════════════════════════════
// TOAST UTILITY (shared)
// ═══════════════════════════════════════════════════════════════
function warrToast(msg, type = '') {
  let t = document.getElementById('warr-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'warr-toast';
    t.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
      background:#171c2a;border:1px solid #2a3349;color:#dce4f0;
      font-size:12px;font-weight:600;padding:9px 18px;border-radius:8px;
      transition:transform .25s cubic-bezier(.34,1.56,.64,1);z-index:9999;
      box-shadow:0 4px 20px rgba(0,0,0,.5);white-space:nowrap;pointer-events:none;
      font-family:'Inter',sans-serif;`;
    document.body.appendChild(t);
  }
  if (type === 'error') t.style.borderColor = 'rgba(240,82,82,.5)';
  else if (type === 'success') t.style.borderColor = 'rgba(52,209,122,.4)';
  else t.style.borderColor = '#2a3349';
  t.textContent = msg;
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.style.transform = 'translateX(-50%) translateY(80px)'; }, 2800);
}

// ═══════════════════════════════════════════════════════════════
// LEAGUES — admin-managed official competition leagues
// ═══════════════════════════════════════════════════════════════

/** Load all leagues (public) */
WDB.loadLeagues = async function() {
  const { data, error } = await _sbClient
    .from('leagues')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
};

/** Save (upsert) a league. Admin only — caller must check WAdmin.isAdmin().
 *  When the caller explicitly sets current_season but the column doesn't
 *  exist in the schema cache yet, we throw a clear error so the user knows
 *  to run the migration — silently dropping the field would lose the user's
 *  selection (which is what 'season reverts to no current' was).
 *  When current_season is NOT set, we save the league row normally even if
 *  the column is missing. */
WDB.saveLeague = async function(league) {
  const user = WAuth.getUser();
  const baseRow = { name: league.name, region: league.region || null,
                created_by: user?.id };
  if (league.id) baseRow.id = league.id;
  const row = { ...baseRow };
  const wantsCurrentSeason = league.current_season !== undefined;
  if (wantsCurrentSeason) row.current_season = league.current_season || null;

  const attempt = async (payload) => _sbClient.from('leagues').upsert(payload, { onConflict: 'id' }).select().single();
  let { data, error } = await attempt(row);
  if (error && /current_season/i.test(error.message || '')) {
    // Did the user explicitly want a non-empty season? If so, don't silently
    // lose it — surface a clear migration message.
    if (wantsCurrentSeason && league.current_season) {
      throw new Error(
        "Current-season feature needs a one-time Supabase migration.\n\n" +
        "In Supabase → SQL Editor, run:\n\n" +
        "  ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS current_season text;\n" +
        "  NOTIFY pgrst, 'reload schema';\n\n" +
        "Then try again."
      );
    }
    // No season requested — just create/update the league without it.
    console.warn('[WDB] current_season column missing in schema cache; saving league row without it.');
    ({ data, error } = await attempt(baseRow));
  }
  if (error) throw error;
  return data;
};

/** Look up the admin-marked current season for a league name. Returns string or null.
 *  Returns null silently if the column doesn't exist yet (graceful degradation). */
WDB.getCurrentSeasonForLeague = async function(leagueName) {
  if (!leagueName || leagueName === 'all') return null;
  try {
    const { data, error } = await _sbClient
      .from('leagues')
      .select('current_season')
      .eq('name', leagueName)
      .maybeSingle();
    if (error || !data) return null;
    return data.current_season || null;
  } catch (e) {
    return null; // column missing or other transient issue
  }
};

/** Delete a league and all its seasons. Admin only. */
WDB.deleteLeague = async function(id) {
  const { error } = await _sbClient.from('leagues').delete().eq('id', id);
  if (error) throw error;
};

// ═══════════════════════════════════════════════════════════════
// SEASONS — per-league seasons/splits
// ═══════════════════════════════════════════════════════════════

/** Load seasons for a specific league (or all if leagueId omitted) */
WDB.loadSeasons = async function(leagueId) {
  let q = _sbClient.from('seasons').select('*').order('start_date', { ascending: false });
  if (leagueId) q = q.eq('league_id', leagueId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

/** Save (upsert) a season. Admin only. */
WDB.saveSeason = async function(season) {
  const row = {
    league_id: season.league_id,
    name: season.name,
    split: season.split || null,
    start_date: season.start_date || null,
    end_date: season.end_date || null,
    is_active: !!season.is_active,
  };
  if (season.id) row.id = season.id;
  const { data, error } = await _sbClient.from('seasons').upsert(row, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return data;
};

/** Delete a season. Admin only. */
WDB.deleteSeason = async function(id) {
  const { error } = await _sbClient.from('seasons').delete().eq('id', id);
  if (error) throw error;
};

// ═══════════════════════════════════════════════════════════════
// PLAYERS — team rosters
// ═══════════════════════════════════════════════════════════════

/** Load players. Pass teamName to filter to one team. */
WDB.loadPlayers = async function(teamName) {
  let q = _sbClient.from('players').select('*').order('ign');
  if (teamName) q = q.eq('team_name', teamName);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

/** Save (upsert) a player. */
WDB.PLAYER_ROLES = ['Gold','Jungle','Mid','EXP','Roam'];
WDB.savePlayer = async function(player) {
  const user = WAuth.getUser();
  // Normalize role: accept only valid values, otherwise store NULL
  const role = WDB.PLAYER_ROLES.includes(player.role) ? player.role : null;
  const row = {
    ign: player.ign,
    real_name: player.real_name || null,
    team_name: player.team_name,
    role,
    is_active: player.is_active !== false,
    created_by: user?.id,
  };
  if (player.id) row.id = player.id;
  const { data, error } = await _sbClient.from('players').upsert(row, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return data;
};

/** Delete a player record. */
WDB.deletePlayer = async function(id) {
  const { error } = await _sbClient.from('players').delete().eq('id', id);
  if (error) throw error;
};

// ═══════════════════════════════════════════════════════════════
// PLAYER HERO POOL — compute from tagged match data
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a player's hero pool stats from an array of matches.
 *
 * @param {Array}  matches   — array of match objects (from WDB.loadMatches())
 * @param {string} playerIgn — the player's IGN to look up in pick.player fields
 * @param {Object} filters   — optional { league, season, source: 'official'|'scrims'|'all' }
 *
 * @returns {Object} {
 *   byRole: { EXP: { Chou: { games:14, wins:10 } }, ... },
 *   total:  { Chou: { games:14, wins:10 }, ... },
 *   games:  number  (total tagged games)
 * }
 */
WDB.computePlayerHeroPool = function(matches, playerIgn, filters = {}) {
  const { league, season, source = 'all' } = filters;

  const isScrimSource = m => m.league === 'Scrims' || m._source === 'scrim';
  const isOfficialSource = m => !isScrimSource(m);

  const filtered = matches.filter(m => {
    if (source === 'official' && !isOfficialSource(m)) return false;
    if (source === 'scrims'   && !isScrimSource(m))   return false;
    if (league  && m.league  !== league)  return false;
    if (season  && m.season  !== season)  return false;
    return true;
  });

  const byRole = {};
  const total  = {};
  let totalGames = 0;

  filtered.forEach(m => {
    const sides = [
      { picks: m.bluePicks || [], won: m.winner === 'blue' },
      { picks: m.redPicks  || [], won: m.winner === 'red'  },
    ];
    sides.forEach(({ picks, won }) => {
      picks.forEach(p => {
        if (!p.player || p.player.toLowerCase() !== playerIgn.toLowerCase()) return;
        const hero = p.name;
        const lane = p.lane || 'Unknown';

        if (!byRole[lane])        byRole[lane] = {};
        if (!byRole[lane][hero])  byRole[lane][hero] = { games: 0, wins: 0 };
        if (!total[hero])         total[hero] = { games: 0, wins: 0 };

        byRole[lane][hero].games++;
        total[hero].games++;
        if (won) { byRole[lane][hero].wins++; total[hero].wins++; }
        totalGames++;
      });
    });
  });

  return { byRole, total, games: totalGames };
};

// ═══════════════════════════════════════════════════════════════
// ADMIN HELPERS — verified team check
// ═══════════════════════════════════════════════════════════════

/**
 * Returns true if the current user is a verified (approved) official team.
 * Reads from the cached profile in localStorage.
 */
WAdmin.isVerifiedTeam = function() {
  if (WAdmin.isAdmin()) return true; // admin has all permissions
  try {
    const profile = JSON.parse(localStorage.getItem('warr_user_profile') || '{}');
    return profile.team_status === 'approved';
  } catch(e) { return false; }
};

/**
 * Returns the team_name of the current user (from cached profile).
 * Used to enforce "can only edit own team" for verified teams.
 */
WAdmin.myTeamName = function() {
  try {
    const profile = JSON.parse(localStorage.getItem('warr_user_profile') || '{}');
    return profile.team_name || null;
  } catch(e) { return null; }
};

/**
 * Check if the current user can manage players/roster for the given teamName.
 * Admin: any team. Verified team: own team only.
 */
WAdmin.canManageTeam = function(teamName) {
  if (WAdmin.isAdmin()) return true;
  if (WAdmin.isVerifiedTeam() && WAdmin.myTeamName() === teamName) return true;
  return false;
};
