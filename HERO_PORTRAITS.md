# Warr.GG — Hero Portraits Guide

How to add, replace, and prepare hero portrait images so they look good
everywhere on the site.

---

## TL;DR

1. **Folder:** `./portraits/`
2. **Filename:** `<HeroName>.png` — exact case, exact spelling (see Aliases below for the few exceptions).
3. **Recommended size:** **500 × 500 px square**, PNG, transparent background OK but solid dark is fine too.
4. **One file per hero** — every page across the site uses the same image at different render sizes (CSS handles it).

---

## Where portraits show up

The site uses one master portrait per hero, rendered at different sizes:

| Page                         | Render size          | Crop / shape           |
|------------------------------|----------------------|------------------------|
| Homepage Meta Hierarchies    | ~140 × 175 px        | 4:5 portrait, gradient overlay |
| Draft Board hero picker      | ~46 × 46 px          | Square, rounded corners |
| Draft Board pick slots       | ~32 × 32 px          | Square thumb |
| AI Battle hero picker        | ~46 × 46 px          | Square, rounded corners |
| Scout draft display          | 20 / 26 / 32 px      | Small thumbs |
| Heroes page cards            | ~120 × 120 px        | Large card |
| Stats / Analysis tables      | 24 / 28 px           | Tiny thumbs |
| Team Manager player rows     | 20 px                | Tiny thumb |

Since **CSS scales the same source image** to every render size, you only
need to upload **one** PNG per hero. Recommendation: **500 × 500 square**
gives crisp edges at every size and keeps file size reasonable.

---

## Naming convention

Files must be named exactly after the hero's `n` field in
`WDB.HERO_ROSTER` (in `warr-lib.js`). **Case matters.**

Examples:

- `Aamon.png`
- `Tigreal.png`
- `Beatrix.png`
- `Wanwan.png`

### Aliases — the seven exceptions

A few heroes have characters in their names that don't play nice with
filesystems or URLs. These are mapped via `WDB.PORTRAIT_ALIAS` in
`warr-lib.js`. **Use the aliased filename, NOT the literal hero name:**

| Hero name      | Save the file as     |
|----------------|----------------------|
| Yi Sun-shin    | `YSS.png`            |
| Popol & Kupa   | `Popol.png`          |
| Lapu-Lapu      | `LapuLapu.png`       |
| X.Borg         | `Xborg.png`          |
| Yu Zhong       | `YuZhong.png`        |
| Luo Yi         | `luoyi.png`          |
| Chang'e        | `Change.png` *(if you add this hero — see Adding new heroes below)*|

If you ever add a hero whose name has an apostrophe, an ampersand,
a period, or a hyphen, add an alias entry to `PORTRAIT_ALIAS` and use
that aliased name as your filename.

---

## Image specs

| Spec        | Recommended            | Acceptable           |
|-------------|------------------------|----------------------|
| Format      | **PNG**                | JPG (smaller, no transparency) |
| Dimensions  | **500 × 500 px**       | Square between 300×300 and 800×800 |
| Aspect ratio| **1:1 (square)**       | 4:5 portrait works (Homepage uses 4:5 crop with CSS) |
| File size   | Under 150 KB           | Under 300 KB |
| Background  | Solid dark or transparent | Both work — the site crops to circle/rounded square |
| Color profile | sRGB                 | sRGB |

**Why 500×500?** Tested every render size on the site — 500 is the
sweet spot. Sharp on the largest card (Heroes page at 120 px and the
Homepage at 175 px) without bloating page weight on the small thumbs.

---

## How to replace an existing portrait

1. Prepare your PNG following the specs above
2. Save it to `./portraits/<HeroName>.png` (overwriting the old one)
3. Hard-refresh the browser (`Cmd+Shift+R` / `Ctrl+Shift+R`) to bust the cache
4. The new portrait shows everywhere on the next page load

You don't need to edit any code — the lookup is centralized in
`WDB.heroPortrait(name)` in `warr-lib.js`, and every page calls it.

---

## How to add a new hero

When MOONTON releases a new hero, two steps:

### Step 1 — Add the hero to the roster

Open `warr-lib.js`, find `WDB.HERO_ROSTER` (around line 1016), and add
an entry alphabetically within their role group:

```js
{ n: 'NewHero', r: 'Assassin' },  // or 'Tank', 'Fighter', 'Mage', 'Marksman', 'Support', or combos like 'Tank/Fighter'
```

If the hero has a special character in their name (', &, ., -, etc),
also add an entry to `WDB.PORTRAIT_ALIAS`:

```js
WDB.PORTRAIT_ALIAS = {
  // ...existing entries...
  'New-Hero': 'NewHero',  // strips the hyphen
};
```

### Step 2 — Add the portrait file

Drop your PNG into `./portraits/`. If you added an alias in Step 1, use
the aliased filename (e.g. `NewHero.png`, not `New-Hero.png`).

### Step 3 — (Optional) Add to lane defaults

If the hero has a definitive lane (e.g. always Jungle), add an entry to
`WDB.HERO_LANE_DEFAULTS` so the AI Battle and Coach engines know:

```js
WDB.HERO_LANE_DEFAULTS = {
  // ...existing entries...
  'NewHero': ['Jungle'],            // single lane
  'NewFlexHero': ['Mid', 'Gold'],   // multi-lane flex
};
```

### Step 4 — Hard-refresh

After saving and pushing your changes, hard-refresh the browser. The
new hero appears in every page that lists the roster.

---

## How to verify a portrait is wired

1. Open the homepage
2. Hard-refresh (`Cmd+Shift+R`)
3. Navigate to Meta Hierarchies → switch lane tabs
4. Top 5 heroes per lane will show portraits if their PNG file exists in `./portraits/`
5. Heroes without a PNG show a tinted gradient with the first letter — that's the fallback, indicating the file is missing or misnamed

Quick way to find which hero portraits you're missing:

```bash
cd "Warr GG"
ls portraits/ > /tmp/have.txt
# Then compare against WDB.HERO_ROSTER names
```

---

## Where the code lives

| What                            | File             | Symbol                          |
|---------------------------------|------------------|----------------------------------|
| Master hero list                | `warr-lib.js`    | `WDB.HERO_ROSTER`                |
| Filename alias map              | `warr-lib.js`    | `WDB.PORTRAIT_ALIAS`             |
| Portrait URL helper             | `warr-lib.js`    | `WDB.heroPortrait(name)`         |
| Hero lane defaults (for AI)     | `warr-lib.js`    | `WDB.HERO_LANE_DEFAULTS`         |
| Hero cards (homepage)           | `index.html`     | `.hero-card` CSS + render        |
| Hero cards (Heroes page)        | `heroes.html`    | hero card render                 |
| Hero picker (Draft Board)       | `draft_board.html`| `iu()` / `iun()`                |
| Hero picker (AI Battle)         | `ai_battle.html` | `iu()` / `iun()`                |

If you ever need to change the master portrait lookup, edit
`WDB.heroPortrait` in `warr-lib.js` — everything downstream picks it up
automatically.
