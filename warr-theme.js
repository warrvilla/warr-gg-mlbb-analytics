// ═══════════════════════════════════════════════════════════════
// WARR.GG — Theme Switcher
// warr-theme.js  |  Include in <head> before closing </head>
// ═══════════════════════════════════════════════════════════════

(function() {
  var THEME_KEY = 'warr_theme';
  var THEMES = ['dark', 'light', 'neon'];

  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'dark';
    // Set on <html> so CSS [data-theme] selectors fire
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    // Update button active states
    var btns = document.querySelectorAll('.theme-btn[data-t]');
    btns.forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-t') === theme);
    });
  }

  // Apply saved theme immediately (before paint, no flash)
  var saved = localStorage.getItem(THEME_KEY) || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  // Wire up buttons after DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    var saved2 = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved2);

    document.querySelectorAll('.theme-btn[data-t]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        applyTheme(btn.getAttribute('data-t'));
      });
    });
  });

  // Expose globally
  window.WTheme = { apply: applyTheme };
})();
