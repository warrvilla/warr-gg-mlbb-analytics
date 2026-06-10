# Warr.GG — Logo & Favicon Guide

How to install your brand logo and favicon site-wide.

---

## TL;DR

Drop these files into `./assets/`:

| File                       | Used as                                    | Recommended dimensions             |
|----------------------------|--------------------------------------------|------------------------------------|
| `assets/logo.png`          | Reserved for full-color uses (future)      | 480 × 480 px, PNG, transparent bg  |
| `assets/logo-white.png`    | **Nav bar** (default — dark theme)         | 240 × 240 px, PNG, transparent bg  |
| `assets/logo-black.png`    | Light theme nav bar                        | 240 × 240 px, PNG, transparent bg  |
| `assets/favicon.jpg`       | Browser tab icon                           | 256 × 256 px, square               |

That's it. Once those four files exist with those names, the nav bar and every page's browser-tab icon use them automatically — no code changes needed.

---

## What you have, where to put it

You said you have:
- A **favicon** (JPEG)
- Primary, white, and black **logos** (PNG)

Rename and drop them like this:

```
Warr GG/
└── assets/
    ├── logo.png         ← your primary (full-color) PNG
    ├── logo-white.png   ← your white PNG
    ├── logo-black.png   ← your black PNG
    └── favicon.jpg      ← your favicon JPEG
```

Hard-refresh (`Cmd+Shift+R`) and the nav + browser tab pick them up.

---

## Sizes and format guide

| Purpose      | Recommended            | Acceptable           | Why                                                |
|--------------|------------------------|----------------------|----------------------------------------------------|
| Nav bar logo | **240 × 240 px PNG**   | 120–480 px square    | Renders at 22 × 22 on screen but stays sharp on retina + admin zooms |
| Favicon      | **256 × 256 px**       | 64 × 64 minimum      | Browsers down-sample to whatever tab size — start big |
| Background   | Transparent            | Solid dark fine too  | Logo sits over `--bg: #050509` |
| Color profile| sRGB                   | sRGB                 | Avoid washed-out colors |
| File size    | Under 30 KB            | Under 100 KB         | Loads on every page |

**Why white as the default?** The whole site is dark themed (cinematic black + amethyst accent). A white logo reads cleanly. If/when you want a light theme variant, the `logo-black.png` file gets swapped in via CSS automatically.

---

## What it replaces

Before: a small **gradient W square** rendered inline in the nav bar via CSS (`background: linear-gradient(amethyst → indigo)` with a `W` character on top).

After: your actual logo image at the same nav-bar position, scaled to the same 22 × 22 box.

The text wordmark `WARR.GG` next to the mark stays as-is — that's a separate element.

---

## How the code finds your logo

`warr-nav.js` renders this on every page:

```html
<a class="nav-brand" href="index.html">
  <img class="nav-brand-mark" src="assets/logo-white.png" alt="WARR.GG">
  <span class="nav-brand-text">WARR<span class="dot">.</span>GG</span>
</a>
```

CSS sizes it to 22 × 22 with `object-fit: contain` and a subtle drop shadow for the dark background.

Every HTML page gets a favicon link in `<head>`:

```html
<link rel="icon" type="image/jpeg" href="assets/favicon.jpg">
```

If you later want to switch to a `.png` favicon for cleaner edges, drop `favicon.png` into `assets/` and change the `type` to `image/png`.

---

## Replacing a logo later

Same flow as the initial install: overwrite the file in `./assets/` with the same filename, hard-refresh, done. No code changes ever.

---

## Where the code lives

| What                       | File              | Symbol / Selector            |
|----------------------------|-------------------|------------------------------|
| Brand mark rendered into nav | `warr-nav.js`    | `.nav-brand-mark` `<img>`    |
| Brand mark CSS sizing      | `warr-styles.css` | `.nav-brand-mark`            |
| Favicon link               | every `*.html`    | `<link rel="icon">` in head  |
