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

  /** Save or update a user's profile (display_name required, team_name optional).
   *  Called after invite acceptance. */
  async saveProfile(displayName, teamName = null) {
    const user = this._user || (await _sbClient.auth.getUser()).data.user;
    if (!user) return { error: { message: 'Not authenticated' } };
    const payload = { id: user.id, display_name: displayName.trim() };
    if (teamName) payload.team_name = teamName.trim();
    const { error } = await _sbClient.from('profiles').upsert(payload, { onConflict: 'id' });
    if (!error) this._profile = { ...this._profile, ...payload };
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
