// Warr.GG — scheduled: refresh hero kits + patch notes from Liquipedia every 6 hours.
// Only pages that changed are downloaded (see netlify/lib/hero-data.mjs).
import { refresh } from '../lib/hero-data.mjs';

export default async () => {
  try {
    const s = await refresh({ budgetMs: 24000 });
    console.log('hero-data refresh', JSON.stringify({ ok: s.ok, partial: s.partial, error: s.error, requests: s.requests, heroes: s.heroes, patches: s.patches, changed: s.changed.length }));
  } catch (e) {
    console.error('hero-data refresh failed', e);
  }
};

export const config = { schedule: '23 */6 * * *' };
