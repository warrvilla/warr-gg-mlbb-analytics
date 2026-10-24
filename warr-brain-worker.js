// Warr.GG — builds the draft brain (warr-draft-brain.js) off the main thread so
// the page never freezes while it learns from every logged draft.
/* global importScripts, WBrain */
self.onmessage = function (e) {
  try {
    importScripts('warr-intel.js?v=3', 'warr-hero-profiles.js?v=2', 'warr-draft-brain.js?v=2');
    if (e.data.opts && e.data.opts.calendar) WBrain.setCalendar(e.data.opts.calendar);
    if (e.data.opts && e.data.opts.kitProfiles && WHeroProfile.addFromKit) Object.entries(e.data.opts.kitProfiles).forEach(([n, h]) => WHeroProfile.addFromKit(n, h));
    const brain = WBrain.build(e.data.matches || [], e.data.opts || {});
    self.postMessage(WBrain.lite(brain));
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
