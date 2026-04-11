#!/usr/bin/env python3
"""
MLBB Top 100 Global Scraper — warr.gg
======================================
Fully automated daily pipeline:
  1. Launches / focuses BlueStacks
  2. Navigates inside MLBB to Global Leaderboard using Claude Vision
  3. Reads every page, extracts player + hero + WR data
  4. Uploads a dated snapshot to Supabase
  5. Previous snapshots are kept — browse by date on warr.gg

Setup:
  pip install -r requirements.txt
  Set env vars ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
  Run once manually, then schedule with task_scheduler.bat
"""

import os, sys, json, time, base64, io, re, subprocess, datetime

# Force UTF-8 output so box-drawing / emoji chars don't crash on Windows cp1252
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import pyautogui
import pygetwindow as gw
from PIL import ImageGrab, Image
import anthropic
import urllib.request, urllib.error

# ── CONFIG ────────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY    = os.environ.get("ANTHROPIC_API_KEY", "YOUR_ANTHROPIC_KEY")
SUPABASE_URL         = os.environ.get("SUPABASE_URL",      "YOUR_SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "YOUR_SERVICE_ROLE_KEY")

OUTPUT_FILE       = "top100_meta.json"   # local backup always saved
MAX_PAGES         = 25
PAGE_DELAY        = 2.5
CLICK_DELAY       = 0.5
MAX_EMPTY_PAGES   = 3
NAV_MAX_STEPS     = 8    # max Claude-guided taps to reach leaderboard
BLUESTACKS_EXE    = os.environ.get("BLUESTACKS_EXE", r"C:\Program Files\BlueStacks_nxt\HD-Player.exe")

BLUESTACKS_TITLES = [
    "BlueStacks App Player",
    "BlueStacks 5",
    "BlueStacks",
    "HD-Player",
]

# ── CLIENTS ───────────────────────────────────────────────────────────────────
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── WINDOW ────────────────────────────────────────────────────────────────────
def find_bluestacks():
    for title in BLUESTACKS_TITLES:
        wins = gw.getWindowsWithTitle(title)
        if wins:
            return wins[0]
    return None

def launch_bluestacks():
    print("  Launching BlueStacks...")
    paths = [
        BLUESTACKS_EXE,
        r"C:\Program Files (x86)\BlueStacks_nxt\HD-Player.exe",
        r"C:\Program Files\BlueStacks\BlueStacks.exe",
    ]
    for path in paths:
        if os.path.exists(path):
            subprocess.Popen([path])
            break
    else:
        print("  WARNING: BlueStacks not found at default paths.")
        print("  Edit BLUESTACKS_EXE in scraper.py to point to your install.")
        return False
    print("  Waiting for BlueStacks to load (30s)...")
    for _ in range(30):
        time.sleep(1)
        if find_bluestacks():
            return True
    return False

def get_window():
    win = find_bluestacks()
    if not win:
        if not launch_bluestacks():
            return None
        win = find_bluestacks()
    return win

def activate_and_screenshot(win):
    try:
        win.activate()
    except Exception:
        pass
    time.sleep(CLICK_DELAY)
    x, y, w, h = win.left, win.top, win.width, win.height
    img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
    return img, (x, y, w, h)

def img_to_screen(bounds, img, img_x, img_y):
    """
    Convert coordinates returned by Claude (in image/physical-pixel space)
    back to screen coordinates that pyautogui can click.

    Windows DPI scaling means ImageGrab captures at physical resolution
    while pygetwindow reports logical (scaled-down) window dimensions.
    We compute the ratio and divide so the click lands on the right spot.
    """
    win_x, win_y, win_w, win_h = bounds
    scale_x = img.width  / win_w
    scale_y = img.height / win_h
    abs_x = win_x + int(img_x / scale_x)
    abs_y = win_y + int(img_y / scale_y)
    return abs_x, abs_y

# ── VISION ────────────────────────────────────────────────────────────────────
def to_b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode()

def ask_claude(img, prompt, model="claude-opus-4-6", max_tokens=2048):
    r = client.messages.create(
        model=model, max_tokens=max_tokens,
        messages=[{"role":"user","content":[
            {"type":"image","source":{"type":"base64","media_type":"image/png","data":to_b64(img)}},
            {"type":"text","text":prompt}
        ]}]
    )
    return r.content[0].text.strip()

def parse_json(text):
    text = re.sub(r"^```(?:json)?\s*","",text,flags=re.MULTILINE)
    text = re.sub(r"```\s*$","",text,flags=re.MULTILINE)
    return json.loads(text.strip())

# ── AUTO-NAVIGATION ───────────────────────────────────────────────────────────
NAV_PROMPT = """
You are helping navigate to the Mobile Legends Global Leaderboard screen.

Look at this screenshot and tell me:
1. What screen is currently showing?
2. What single button/element should I tap to get closer to: Leaderboard → Global Rankings (top 100 players with hero + win rate)

Return ONLY JSON:
{
  "screen": "<brief description of current screen>",
  "on_leaderboard": <true if already showing top 100 player rows with hero + WR>,
  "tap": {"x": <x pixel in image>, "y": <y pixel in image>},
  "tap_label": "<what you're tapping>"
}

If already on the leaderboard set "on_leaderboard": true and any values for tap.
If stuck or unclear set "tap": null.
""".strip()

def navigate_to_leaderboard(win):
    """Use Claude Vision to tap through MLBB UI to the Global Leaderboard."""
    print("  Navigating to Global Leaderboard via Claude Vision...")
    for step in range(1, NAV_MAX_STEPS + 1):
        img, bounds = activate_and_screenshot(win)
        try:
            raw = ask_claude(img, NAV_PROMPT, model="claude-opus-4-6", max_tokens=300)
            nav = parse_json(raw)
        except Exception as e:
            print(f"    Step {step}: nav error ({e}) — retrying")
            time.sleep(2)
            continue

        screen   = nav.get("screen","?")
        on_board = nav.get("on_leaderboard", False)
        tap      = nav.get("tap")
        label    = nav.get("tap_label","?")

        if on_board:
            print(f"    Step {step}: ✓ On leaderboard — starting extraction")
            return True

        if not tap:
            print(f"    Step {step}: stuck on '{screen}' — cannot find path")
            return False

        abs_x, abs_y = img_to_screen(bounds, img, tap["x"], tap["y"])
        print(f"    Step {step}: '{screen}' → tapping '{label}' at img({tap['x']},{tap['y']}) → screen({abs_x},{abs_y})")
        pyautogui.click(abs_x, abs_y)
        time.sleep(2.5)

    print("  Could not reach leaderboard after max steps.")
    return False

# ── EXTRACTION ────────────────────────────────────────────────────────────────
EXTRACT_PROMPT = """
This is a Mobile Legends Bang Bang Global Leaderboard screenshot.

Extract every visible player row as a JSON array. Each object:
{
  "rank":     <global rank integer>,
  "player":   <player IGN string>,
  "hero":     <hero name exactly as shown>,
  "win_rate": <win rate as decimal float, e.g. 0.657 for 65.7%>,
  "games":    <total games played integer>
}

Rules:
- win rate "65.7%" → 0.657
- missing field → null
- Return ONLY a valid JSON array, no explanation

If no leaderboard rows visible: []
""".strip()

NEXT_BTN_PROMPT = """
Find the next-page or right-arrow button in this MLBB leaderboard.
Return ONLY JSON (no markdown):
{"found": true, "x": <x pixel>, "y": <y pixel>}
If none: {"found": false}
Coordinates relative to the image.
""".strip()

def extract_entries(img):
    try:
        raw = ask_claude(img, EXTRACT_PROMPT, model="claude-opus-4-6")
        data = parse_json(raw)
        if isinstance(data, list):
            return data
    except Exception as e:
        print(f"    [extract error: {e}]")
    return []

def find_next_button(img):
    try:
        raw = ask_claude(img, NEXT_BTN_PROMPT, model="claude-haiku-4-5-20251001", max_tokens=80)
        return parse_json(raw)
    except Exception:
        return {"found": False}

def click_at(bounds, img, rx, ry):
    """Click at image-space coords (rx, ry), correcting for DPI scaling."""
    abs_x, abs_y = img_to_screen(bounds, img, rx, ry)
    pyautogui.click(abs_x, abs_y)

# ── AGGREGATION ───────────────────────────────────────────────────────────────
def aggregate(entries):
    stats = {}
    for e in entries:
        hero = (e.get("hero") or "").strip()
        if not hero:
            continue
        if hero not in stats:
            stats[hero] = {"hero": hero, "players": []}
        stats[hero]["players"].append({
            "rank":  e.get("rank"),
            "name":  e.get("player"),
            "wr":    e.get("win_rate"),
            "games": e.get("games"),
        })
    result = []
    for hero, d in stats.items():
        players = d["players"]
        wrs   = [p["wr"]    for p in players if p["wr"]    is not None]
        games = [p["games"] for p in players if p["games"] is not None]
        result.append({
            "hero":         hero,
            "top100_users": len(players),
            "avg_win_rate": round(sum(wrs)/len(wrs), 4)   if wrs   else None,
            "avg_games":    round(sum(games)/len(games))   if games else None,
            "players":      sorted(players, key=lambda p: p["rank"] or 9999),
        })
    return sorted(result, key=lambda h: h["top100_users"], reverse=True)

# ── SUPABASE UPLOAD ───────────────────────────────────────────────────────────
def upload_to_supabase(heroes, raw_entries):
    today = datetime.date.today().isoformat()  # e.g. "2026-04-09"
    payload = json.dumps({
        "scraped_at":    today,
        "total_players": len(raw_entries),
        "heroes":        heroes,
        "raw":           raw_entries,
    }).encode("utf-8")

    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/top100_snapshots"
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "apikey":        SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type":  "application/json",
            "Prefer":        "resolution=merge-duplicates",  # upsert by scraped_at
        }
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"  ✓ Uploaded to Supabase (date: {today}, status: {resp.status})")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ✗ Supabase upload failed: {e.code} — {body}")
        return False
    except Exception as e:
        print(f"  ✗ Supabase upload error: {e}")
        return False

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print()
    print("╔══════════════════════════════════════════╗")
    print("║   MLBB Top 100 Scraper — warr.gg         ║")
    print(f"║   {datetime.datetime.now().strftime('%Y-%m-%d  %H:%M:%S')}                    ║")
    print("╚══════════════════════════════════════════╝")
    print()

    # Validate config
    missing = [k for k,v in [
        ("ANTHROPIC_API_KEY",    ANTHROPIC_API_KEY),
        ("SUPABASE_URL",         SUPABASE_URL),
        ("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY),
    ] if v.startswith("YOUR_")]
    if missing:
        print(f"ERROR: Missing config: {', '.join(missing)}")
        print("Set them as environment variables or edit scraper.py directly.")
        sys.exit(1)

    # Get / launch BlueStacks
    print("[ 1/4 ] Finding BlueStacks...")
    win = get_window()
    if not win:
        print("ERROR: Could not open BlueStacks.")
        sys.exit(1)
    print(f"  ✓ Window: \"{win.title}\" ({win.width}×{win.height})")

    # Navigate to leaderboard
    print()
    print("[ 2/4 ] Navigating to Global Leaderboard...")
    if not navigate_to_leaderboard(win):
        print("ERROR: Could not navigate to leaderboard automatically.")
        print("Please open the leaderboard manually and re-run.")
        sys.exit(1)

    # Scrape pages
    print()
    print("[ 3/4 ] Scraping pages...")
    all_entries, seen_ranks, empty_streak, page = [], set(), 0, 1

    while page <= MAX_PAGES:
        print(f"  Page {page:02d} — ", end="", flush=True)
        img, bounds = activate_and_screenshot(win)
        entries = extract_entries(img)

        new = []
        for e in entries:
            r = e.get("rank")
            if r is not None:
                if r not in seen_ranks:
                    seen_ranks.add(r)
                    new.append(e)
            else:
                new.append(e)

        if new:
            all_entries.extend(new)
            print(f"✓ {len(new)} players  (total: {len(all_entries)})")
            empty_streak = 0
        else:
            print("no data")
            empty_streak += 1
            if empty_streak >= MAX_EMPTY_PAGES:
                print(f"  Stopped: {MAX_EMPTY_PAGES} empty pages in a row.")
                break

        nav = find_next_button(img)
        if not nav.get("found"):
            print("  ✓ Last page reached.")
            break

        click_at(bounds, img, nav["x"], nav["y"])
        time.sleep(PAGE_DELAY)
        page += 1

    print(f"\n  Total: {len(all_entries)} unique players across {page} page(s)")

    # Aggregate + upload
    print()
    print("[ 4/4 ] Aggregating and uploading...")
    heroes = aggregate(all_entries)

    output = {
        "generated_at":          datetime.datetime.now().isoformat(),
        "total_players_scanned": len(all_entries),
        "heroes":                heroes,
        "raw":                   all_entries,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"  ✓ Local backup saved → {OUTPUT_FILE}")

    upload_to_supabase(heroes, all_entries)

    # Summary
    print()
    print("Top 10 heroes in today's top 100:")
    print(f"  {'Hero':<18} {'Players':>7}   {'Avg WR':>7}   {'Avg Games':>10}")
    print(f"  {'─'*18}   {'─'*7}   {'─'*7}   {'─'*10}")
    for h in heroes[:10]:
        wr  = f"{h['avg_win_rate']*100:.1f}%" if h["avg_win_rate"] is not None else "—"
        gms = str(h["avg_games"])             if h["avg_games"]    is not None else "—"
        print(f"  {h['hero']:<18} {h['top100_users']:>7}   {wr:>7}   {gms:>10}")
    print()
    print("Done.")

if __name__ == "__main__":
    main()
