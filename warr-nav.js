/**
 * warr-nav.js — single source of truth for the app navigation.
 *
 * Usage on every page:
 *   <div id="warr-nav-root"></div>
 *   <script src="warr-lib.js"></script>
 *   <script src="warr-nav.js"></script>
 *
 * The script:
 *   • Renders a canonical <nav> + mobile menu into #warr-nav-root
 *   • Auto-marks the current page as .active via location.pathname
 *   • Mounts #authChip and calls WAuth.renderAuthChip
 *   • Reveals admin-only links (ids prefixed adminNav_) if WAdmin.isAdmin()
 *   • Includes optional theme switcher (wires warr-theme.js if present)
 *   • Wires mobile menu toggle
 *
 * Branding is unified with index.html — same gradient-W mark, same
 * "WARR.GG" wordmark, same amethyst accent for the active link.
 *
 * Backward-compat: if a page has hardcoded <nav class="topnav"> AND no
 * placeholder, the script just de-dupes links and applies active state.
 */
(function () {
  'use strict';

  // ── Baseline nav CSS ─────────────────────────────────────────────
  // Injected into <head> before any page CSS so pages that already
  // style .topnav/.nav-link etc. keep their look; pages that don't
  // (auth.html, setup-guide.html, counters.html, top100.html) get a
  // sane default instead of rendering an unstyled stack of anchors.
  //
  // Palette matches warr-styles.css — amethyst accent (#7C5CF6) on a
  // glassy black bar. No more legacy gold (#f4a534).
  const BASELINE_CSS = `
    nav.topnav {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 24px;
      height: 52px;
      position: sticky;
      top: 0;
      z-index: 500;
      background: rgba(7,7,12,0.82);
      backdrop-filter: blur(48px) saturate(140%);
      -webkit-backdrop-filter: blur(48px) saturate(140%);
      border-bottom: .5px solid rgba(255,255,255,0.06);
      box-shadow: 0 1px 0 rgba(255,255,255,0.03), 0 4px 32px rgba(0,0,0,0.5);
    }
    nav.topnav .nav-brand {
      display: inline-flex; align-items: center; gap: 10px;
      text-decoration: none; color: inherit;
      margin-right: 16px; flex-shrink: 0;
    }
    /* Shared box for both <img> and <span> fallback. */
    nav.topnav .nav-brand-mark {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    /* <img> form: render the logo image straight, no gradient/text styling
       so there's NO flash of a gradient W square while the PNG loads. */
    nav.topnav img.nav-brand-mark {
      object-fit: contain;
      border-radius: 4px;
      background: transparent;
      box-shadow: none;
    }
    nav.topnav img.nav-brand-mark.loaded {
      box-shadow: 0 0 12px rgba(124,92,246,0.25);
    }
    /* <span> form: only used as the onerror fallback when the logo file
       isn't deployed. Keeps the brand W look so the nav never renders empty. */
    nav.topnav span.nav-brand-mark {
      border-radius: 6px;
      background: linear-gradient(135deg, #7C5CF6 0%, #5E5CE6 100%);
      box-shadow:
        0 0 12px rgba(124,92,246,0.45),
        inset 0 1px 0 rgba(255,255,255,0.25);
      font-family: -apple-system,'SF Pro Display','Inter','Helvetica Neue',sans-serif;
      font-size: 11px; font-weight: 900; color: #fff; letter-spacing: 0;
    }
    nav.topnav .nav-brand-text {
      display: inline-flex; align-items: baseline; gap: 0;
      font-family: -apple-system,'SF Pro Display','Inter','Helvetica Neue',sans-serif;
      font-weight: 800; letter-spacing: 0.02em;
      font-size: 14px; color: var(--text,#F0F0F8);
    }
    nav.topnav .nav-brand-text .dot { color: #7C5CF6; }
    nav.topnav .nav-links { display: flex; align-items: center; gap: 2px; flex: 1; }
    nav.topnav .nav-link {
      padding: 5px 12px; font-size: 13px; font-weight: 500;
      letter-spacing: -0.01em; text-transform: none;
      color: var(--text3,rgba(240,240,248,0.45));
      text-decoration: none; border-radius: 9999px;
      transition: background .18s ease, color .18s ease;
      white-space: nowrap;
    }
    nav.topnav .nav-link:hover {
      background: rgba(255,255,255,0.07);
      color: var(--text2,rgba(240,240,248,0.78));
    }
    nav.topnav .nav-link.active {
      background: rgba(124,92,246,0.13);
      color: #F0F0F8;
      box-shadow: inset 0 0 0 0.5px rgba(124,92,246,0.24);
    }
    nav.topnav .nav-right { display: flex; align-items: center; gap: 10px; margin-left: auto; flex-shrink: 0; }
    nav.topnav .nav-profile-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 50%;
      border: 0.5px solid rgba(255,255,255,0.12); color: var(--text2,#aab);
      background: rgba(255,255,255,0.04); transition: all .15s ease; text-decoration: none;
    }
    nav.topnav .nav-profile-btn:hover { color: #7C5CF6; border-color: rgba(124,92,246,0.4); background: rgba(124,92,246,0.1); }
    .wauth-admin { font-size: 11px; font-weight: 700; color: #C89050; text-decoration: none; padding: 3px 9px; border-radius: 7px; border: 0.5px solid rgba(200,144,80,.35); background: rgba(200,144,80,.08); margin-right: 2px; }
    .wauth-admin:hover { background: rgba(200,144,80,.18); }
    nav.topnav .theme-switcher { display: inline-flex; gap: 2px; padding: 3px; border-radius: 8px; background: rgba(255,255,255,.04); }
    nav.topnav .theme-btn {
      width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
      border: 0; background: transparent; color: var(--text3,#8a94a8); cursor: pointer; border-radius: 6px;
    }
    nav.topnav .theme-btn.active { background: rgba(124,92,246,0.15); color: #7C5CF6; }
    nav.topnav .mobile-menu-btn {
      display: none; background: transparent; border: 0; padding: 8px; cursor: pointer; flex-direction: column; gap: 4px;
    }
    nav.topnav .mobile-menu-btn span {
      width: 20px; height: 2px; background: var(--text,#e6ebf5); border-radius: 1px; display: block;
    }
    .mobile-nav {
      display: none; flex-direction: column; padding: 8px 12px; gap: 2px;
      background: rgba(7,7,12,0.96);
      backdrop-filter: blur(40px) saturate(140%);
      -webkit-backdrop-filter: blur(40px) saturate(140%);
      border-bottom: .5px solid rgba(255,255,255,0.06);
      position: sticky; top: 52px; z-index: 499;
    }
    .mobile-nav.open { display: flex; }
    .mobile-nav .mobile-nav-link {
      padding: 10px 12px; border-radius: 8px; color: var(--text2,#aab3c4); text-decoration: none; font-weight: 500; font-size: 13px;
    }
    .mobile-nav .mobile-nav-link.active { background: rgba(124,92,246,0.12); color: #F0F0F8; }
    @media (max-width: 820px) {
      nav.topnav .nav-links { display: none; }
      nav.topnav .mobile-menu-btn { display: inline-flex; }
    }
  `;

  function injectBaseline() {
    if (document.querySelector('style[data-warr-nav]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-warr-nav', '');
    style.textContent = BASELINE_CSS;
    // Prepend to <head> so page-specific CSS (which appears later) can override.
    const head = document.head || document.documentElement;
    if (head.firstChild) head.insertBefore(style, head.firstChild);
    else head.appendChild(style);
  }

  // ── Canonical link list (single source of truth) ────────────────
  // Order here = order rendered. Each entry: { href, label, adminOnly? }
  //
  // Keep labels short and aligned with index.html's cinematic top bar.
  const NAV_LINKS = [
    { href: '/',             label: 'Home'      },
    { href: '/ai_battle',    label: 'AI Battle' },
    { href: '/scout',        label: 'Scout'     },
    { href: '/scrims',       label: 'Scrims'    },
    { href: '/stats',        label: 'Analysis'  },
    { href: '/heroes',       label: 'Heroes'    },
    { href: '/team_manager', label: 'Teams'     },
  ];

  // Identify current page from URL path — works for both /heroes and
  // /heroes.html so the active state survives old links and local files.
  function currentPage() {
    const path = ((location.pathname || '').split('/').pop() || 'index')
      .toLowerCase().replace(/\.html$/, '');
    return path || 'index';
  }

  function isActive(href) {
    const h = href === '/' ? 'index' : href.replace(/^\//, '').replace(/\.html$/, '').toLowerCase();
    return h === currentPage();
  }

  // ── Render canonical nav HTML ────────────────────────────────────
  function renderNav() {
    const links = NAV_LINKS.map(l => {
      const cls = 'nav-link' + (isActive(l.href) ? ' active' : '');
      const style = l.adminOnly ? 'style="display:none;color:#7C5CF6;"' : '';
      const idAttr = l.id ? `id="${l.id}"` : '';
      return `<a class="${cls}" ${idAttr} href="${l.href}" ${style}>${l.label}</a>`;
    }).join('\n    ');

    const mobileLinks = NAV_LINKS.map(l => {
      const cls = 'mobile-nav-link' + (isActive(l.href) ? ' active' : '');
      const style = l.adminOnly ? 'style="display:none;color:#7C5CF6;"' : '';
      const idAttr = l.id ? `id="${l.id}_m"` : '';
      return `<a class="${cls}" ${idAttr} href="${l.href}" ${style}>${l.label}</a>`;
    }).join('\n  ');

    return `
<nav class="topnav">
  <a class="nav-brand" href="/" aria-label="Warr.GG home">
    <img class="nav-brand-mark" src="assets/logo.png" alt="WARR.GG" onload="this.classList.add('loaded')" onerror="this.outerHTML='<span class=&quot;nav-brand-mark&quot;>W</span>'">
    <span class="nav-brand-text">WARR<span class="dot">.</span>GG</span>
  </a>
  <div class="nav-links">
    ${links}
  </div>
  <div class="nav-right">
    <div class="theme-switcher" title="Switch theme">
      <button class="theme-btn" data-t="dark" title="Dark" aria-label="Dark theme">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
      </button>
      <button class="theme-btn" data-t="light" title="Light" aria-label="Light theme">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      </button>
      <button class="theme-btn" data-t="neon" title="Neon" aria-label="Neon theme">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z"/></svg>
      </button>
    </div>
    <a class="nav-profile-btn" href="/profile" title="Profile & plan" aria-label="Profile">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>
    </a>
    <div id="authChip"></div>
  </div>
  <button class="mobile-menu-btn" id="warrMobileBtn" aria-label="Menu">
    <span></span><span></span><span></span>
  </button>
</nav>
<div class="mobile-nav" id="mobileNav">
  ${mobileLinks}
</div>`;
  }

  // ── Mount into #warr-nav-root (preferred) ────────────────────────
  function mountCanonical(root) {
    root.outerHTML = renderNav();
  }

  // ── Backward compat: patch existing hardcoded nav ────────────────
  // De-dupe nav-link hrefs, apply active state, hide any stale admin link.
  function patchExistingNav() {
    const here = currentPage();
    const seen = new Set();
    document.querySelectorAll('nav.topnav .nav-link, .mobile-nav .mobile-nav-link').forEach(a => {
      const href = (a.getAttribute('href') || '').toLowerCase();
      if (!href) return;
      // Remove duplicates (e.g. scout.html had Heroes twice)
      if (seen.has(href + '|' + (a.parentElement?.className || ''))) {
        a.remove();
        return;
      }
      seen.add(href + '|' + (a.parentElement?.className || ''));
      // Apply active state based on current URL
      if (href === here) a.classList.add('active');
      else a.classList.remove('active');
    });
  }

  // ── Wire mobile menu toggle ──────────────────────────────────────
  function wireMobile() {
    const btn = document.getElementById('warrMobileBtn') || document.querySelector('.mobile-menu-btn');
    const menu = document.getElementById('mobileNav');
    if (!btn || !menu) return;
    // Replace any inline onclick (may reference old IDs) with our handler
    btn.onclick = (e) => {
      e.preventDefault();
      menu.classList.toggle('open');
    };
    // Close menu when a link is tapped
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => menu.classList.remove('open'));
    });
  }

  // ── Wire theme switcher (if warr-theme.js is loaded) ─────────────
  function wireTheme() {
    const buttons = document.querySelectorAll('.theme-switcher .theme-btn');
    if (!buttons.length) return;

    // Mark currently-active theme button (from localStorage preference)
    let saved = null;
    try { saved = localStorage.getItem('warr_theme'); } catch (_) {}
    const active = saved || 'dark';
    buttons.forEach(b => {
      if (b.dataset.t === active) b.classList.add('active');
      b.addEventListener('click', () => {
        const t = b.dataset.t;
        buttons.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        try { localStorage.setItem('warr_theme', t); } catch (_) {}
        // Delegate to warr-theme.js if present
        if (typeof window.applyTheme === 'function') window.applyTheme(t);
        else document.documentElement.setAttribute('data-theme', t);
      });
    });
    // Apply saved theme on load
    if (typeof window.applyTheme === 'function') window.applyTheme(active);
    else document.documentElement.setAttribute('data-theme', active);
  }

  // ── Reveal admin-only links & render auth chip ──────────────────
  async function postMount() {
    // Render auth chip via WAuth if available
    if (typeof WAuth !== 'undefined') {
      try { await WAuth.restoreSession?.(); } catch (_) {}
      try { WAuth.renderAuthChip?.('authChip'); } catch (_) {}
    }

    // Show admin-only nav items if current user is admin
    if (typeof WAdmin !== 'undefined') {
      try { await WAdmin.loadExtraAdmins?.(); } catch (_) {}
      if (WAdmin.isAdmin?.()) {
        document.querySelectorAll('[id^="adminNav_"]').forEach(el => {
          el.style.display = '';
        });
      }
    }
  }

  // ── Main init ────────────────────────────────────────────────────
  function init() {
    injectBaseline();
    const root = document.getElementById('warr-nav-root');
    if (root) {
      mountCanonical(root);
    } else {
      patchExistingNav();
    }
    wireMobile();
    wireTheme();
    postMount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
