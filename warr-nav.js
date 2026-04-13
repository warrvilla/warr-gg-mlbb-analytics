/**
 * warr-nav.js — shared nav init for every page.
 * Shows admin-only links after WAdmin is ready.
 * Include AFTER warr-lib.js on every page.
 */
(async function initNav() {
  if (typeof WAuth === 'undefined') return;
  await WAuth.restoreSession?.();
  if (typeof WAdmin !== 'undefined') await WAdmin.loadExtraAdmins?.();

  if (WAdmin.isAdmin()) {
    document.querySelectorAll('[id^="adminNav_"]').forEach(el => {
      el.style.display = '';
    });
  }
})();
