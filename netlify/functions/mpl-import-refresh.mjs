// Warr.GG — scheduled every 5 minutes, but only works when it should:
// every 5 min from 15 min before a scheduled MPL match until 4 h after (any weekday —
// the schedule comes from Liquipedia), otherwise once an hour. Only when auto-import is on.
import { run, due, openStore } from '../lib/mpl-import.mjs';
import { heroTitles } from './mpl-import.mjs';

export default async () => {
  try {
    const store = await openStore();
    const state = await store.get('state', { type: 'json' });
    if (!state || !state.auto) return;
    const status = await store.get('status', { type: 'json' });
    const d = due(state, status, Date.now());
    if (!d.due) return;
    const r = await run({ store, apply: true, budgetMs: 24000, heroTitles: await heroTitles() });
    console.log('mpl-import', JSON.stringify({ live: d.live, added: r.applied ? r.add : 0, updated: r.applied ? r.update : 0, upToDate: !!r.upToDate, error: r.error || null, requests: r.requests }));
  } catch (e) { console.error('mpl-import failed', e); }
};

export const config = { schedule: '*/5 * * * *' };
