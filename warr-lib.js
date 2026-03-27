const WARR_CONFIG = {
  supabaseUrl:     window.WARR_SUPABASE_URL  || 'https://nqqlmzdyyhbyvsbybdem.supabase.co',
  supabaseAnonKey: window.WARR_SUPABASE_ANON || 'sb_publishable_14TS_XufXsZnsyw4x2NLAQ_vshJ1KA3',
};

// Initialize Supabase client (requires @supabase/supabase-js CDN)
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
  LOCKED_LEAGUES: ['MPL PH','MPL MY','MPL ID','MPL SG','MSC','M-Series'],

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
  PUBLIC_LEAGUES: ['MPL PH','MPL MY','MPL ID','MPL SG','MSC','M-Series'],

  /** Fetch scout matches — public leagues for everyone, private leagues only own */
  async loadMatches() {
    const { data, error } = await _sbClient
      .from('scout_matches')
      .select('id, data, created_by')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const userId = WAuth.getUser()?.id || null;
    return (data || [])
      .filter(row => {
        const league = row.data?.league || '';
        const isPublic = WDB.PUBLIC_LEAGUES.includes(league);
        const isOwn = row.created_by === userId;
        return isPublic || isOwn; // show public leagues OR your own private matches
      })
      .map(row => ({ ...row.data, id: row.id, _createdBy: row.created_by }));
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
  },

  /** Delete a match from cloud */
  async deleteMatch(id) {
    const { error } = await _sbClient.from('scout_matches').delete().eq('id', id);
    if (error) throw error;
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
      const presence = ((stats.picks + stats.bans) / totalGames) * 100;
      const winRate = stats.picks > 0 ? (stats.wins / stats.picks) * 100 : 0;

      // Tier assignment based on presence + win rate
      // S-tier: >60% presence OR (>35% presence AND >55% WR)
      // A-tier: >30% presence OR (>15% presence AND >52% WR)
      // B-tier: >10% presence
      // C-tier: everything else that appeared
      let tier = 'C';
      if (presence >= 60 || (presence >= 35 && winRate >= 55)) tier = 'S';
      else if (presence >= 30 || (presence >= 15 && winRate >= 52)) tier = 'A';
      else if (presence >= 10) tier = 'B';

      // Meta priority based on presence
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
// ── SUBSCRIPTION / TOKEN SYSTEM ──
// 3-tier: free (5 drafts/day) / pro (50/day) / team (unlimited)
// Plan is set by ADMIN only via Supabase profiles.plan
// Daily usage tracked in profiles.tokens_used + profiles.token_reset_date
//
// Required Supabase SQL (run once):
//   ALTER TABLE public.profiles
//     ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free',
//     ADD COLUMN IF NOT EXISTS tokens_used integer DEFAULT 0,
//     ADD COLUMN IF NOT EXISTS token_reset_date text DEFAULT NULL;
// ═══════════════════════════════════════════════════════════════
WDB.PLANS = {
  free: { label: 'Free', draftsPerDay: 3,   price: 0     },
  pro:  { label: 'Pro',  draftsPerDay: 50,  price: 9.99  },
  team: { label: 'Team', draftsPerDay: 999, price: 29.99 },
};

const _24H = 24 * 60 * 60 * 1000; // 24 hours in ms

// Sync read — reads from WAuth cached profile (call after WAuth.init)
WDB.getSubscription = function() {
  try {
    const profile = (typeof WAuth !== 'undefined' && WAuth.getProfile) ? WAuth.getProfile() : null;
    const plan       = profile?.plan || 'free';
    const tokensUsed = profile?.tokens_used || 0;
    const resetDate  = profile?.token_reset_date || null;
    return { plan, tokensUsed, resetDate };
  } catch(e) { return { plan: 'free', tokensUsed: 0, resetDate: null }; }
};

// Call once per page after WAuth.init() — 24hr rolling window reset per account
WDB.initDailyReset = async function() {
  try {
    if (typeof WAuth === 'undefined' || !WAuth.getUser || !WAuth.getUser()) return;
    const profile = WAuth.getProfile();
    if (!profile) return;
    const resetAt = profile.token_reset_date ? new Date(profile.token_reset_date).getTime() : 0;
    const expired = (Date.now() - resetAt) >= _24H;
    if (expired) {
      // Don't reset if we have no reset timestamp AND tokens_used is already 0 — avoids
      // wiping mid-session just because the column is null on first load
      if (resetAt === 0 && (profile.tokens_used || 0) === 0) {
        // First ever use — just stamp the reset time, don't change count
        await WAuth.saveProfile({ token_reset_date: new Date().toISOString() });
      } else {
        await WAuth.saveProfile({ tokens_used: 0, token_reset_date: new Date().toISOString() });
      }
    }
  } catch(e) { /* silent */ }
};

// Admin-only: reset a specific user's daily draft count
WDB.adminResetUserDrafts = async function(userId) {
  if (typeof WAuth === 'undefined' || !WAdmin.isAdmin()) return { error: 'Admin only' };
  const today = new Date().toISOString().slice(0, 10);
  return WAuth.adminUpdateProfile(userId, { tokens_used: 0, token_reset_date: today });
};

WDB.getTokensRemaining = function() {
  const sub  = WDB.getSubscription();
  const plan = WDB.PLANS[sub.plan] || WDB.PLANS.free;
  return Math.max(0, plan.draftsPerDay - (sub.tokensUsed || 0));
};

// Returns true if draft was counted, false if limit reached
WDB.consumeToken = async function() {
  try {
    const sub  = WDB.getSubscription();
    const plan = WDB.PLANS[sub.plan] || WDB.PLANS.free;
    if ((sub.tokensUsed || 0) >= plan.draftsPerDay) return false;
    const newCount = (sub.tokensUsed || 0) + 1;
    // Optimistic local update (WAuth caches profile)
    if (WAuth._profile) WAuth._profile.tokens_used = newCount;
    // Background sync to Supabase
    if (typeof WAuth !== 'undefined' && WAuth.saveProfile && WAuth.getUser && WAuth.getUser()) {
      WAuth.saveProfile({ tokens_used: newCount }).catch(() => {});
    }
    return true;
  } catch(e) { return true; } // fail open so drafts aren't blocked on network error
};

WDB.canAnalyze = function() {
  return WDB.getTokensRemaining() > 0;
};

// Legacy no-op (kept so old callers don't crash)
WDB.saveSubscription = function() {};

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
/** Returns the portraits/ path for a given hero name */
WDB.heroPortrait = function(name) {
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
// ADMIN HELPERS
// ═══════════════════════════════════════════════════════════════
/** Check if a given email should have admin access (only wrrenvillapando@gmail.com by default).
 *  A secondary admin list is stored in warr_extra_admins localStorage so the primary admin
 *  can grant access to others without a code deploy. */
WAdmin._getExtraAdmins = function() {
  try { return JSON.parse(localStorage.getItem('warr_extra_admins') || '[]'); } catch(e) { return []; }
};
WAdmin._setExtraAdmins = function(list) {
  localStorage.setItem('warr_extra_admins', JSON.stringify(list));
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
