#!/usr/bin/env python3
"""
MLBB Top 100 Global Scraper — warr.gg
======================================
Full 9-step per-player data collection:
  1. Click player row on leaderboard
  2. Click "Check" to open full profile
  3. Click "History" tab
  4. Click each match card
  5. Extract hero, KDA, result, enemies, BattleID
  6. Click "Quit" to return to history cards
  7. Swipe left to reveal more cards (20 matches per player)
  8. After all matches, press back (←) to return to leaderboard
  9. Scroll down leaderboard to reveal next players; repeat for 100

Setup:
  pip install -r requirements.txt
  Set env vars ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
  Run once manually, then schedule with setup_scheduler.bat
"""

import os, sys, json, time, base64, io, re, subprocess, datetime
import pyautogui
import pygetwindow as gw

# Force UTF-8 so box-drawing / unicode chars don't crash on Windows cp1252
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from PIL import ImageGrab, Image
import anthropic
import urllib.request, urllib.error

# Prevent crashes if mouse drifts to screen corner; we manage our own delays
pyautogui.FAILSAFE = False
pyautogui.PAUSE    = 0

# ── CONFIG ────────────────────────────────────────────────────────────────────
# Priority: env var (set by app.py) > config.json (standalone use) > placeholder
def _load_cfg_file():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}

_cfg = _load_cfg_file()

ANTHROPIC_API_KEY    = (os.environ.get("ANTHROPIC_API_KEY")    or _cfg.get("anthropic_key")  or "YOUR_ANTHROPIC_KEY")
SUPABASE_URL         = (os.environ.get("SUPABASE_URL")         or _cfg.get("supabase_url")   or "YOUR_SUPABASE_URL")
SUPABASE_SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or _cfg.get("supabase_key")   or "YOUR_SERVICE_ROLE_KEY")

OUTPUT_FILE        = "top100_meta.json"
MATCHES_PER_PLAYER = int(os.environ.get("MATCHES_PER_PLAYER", "20"))  # up to 20 per player
CARDS_PER_SWIPE    = 4   # ~4 history cards visible at once before needing to swipe
MAX_PLAYERS        = int(os.environ.get("MAX_PLAYERS", "100"))
MAX_SCROLL_MISSES  = 5   # stop if this many leaderboard scrolls reveal no new players
PAGE_DELAY         = 2.5
CLICK_DELAY        = 0.6
NAV_MAX_STEPS      = 10
BLUESTACKS_EXE     = (os.environ.get("BLUESTACKS_EXE") or _cfg.get("bluestacks_exe")
                      or r"C:\Program Files\BlueStacks_nxt\HD-Player.exe")

BLUESTACKS_TITLES = ["BlueStacks App Player", "BlueStacks 5", "BlueStacks", "HD-Player"]

# ── CLIENTS ───────────────────────────────────────────────────────────────────
# Initialised after config is loaded so the API key is always correct
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
    Convert image-space coords (physical pixels returned by Claude) to screen
    coords (logical pixels for pyautogui), correcting for Windows DPI scaling.
    """
    win_x, win_y, win_w, win_h = bounds
    scale_x = img.width  / win_w
    scale_y = img.height / win_h
    return win_x + int(img_x / scale_x), win_y + int(img_y / scale_y)

# ── VISION ────────────────────────────────────────────────────────────────────
def to_b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode()

def ask_claude(img, prompt, model="claude-haiku-4-5-20251001", max_tokens=512):
    r = client.messages.create(
        model=model, max_tokens=max_tokens,
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": to_b64(img)}},
            {"type": "text",  "text": prompt},
        ]}]
    )
    return r.content[0].text.strip()

def parse_json(text):
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$",          "", text, flags=re.MULTILINE)
    return json.loads(text.strip())

def click_element(win, prompt, label="element", model="claude-haiku-4-5-20251001", delay=1.5):
    """
    Ask Claude to locate an element and click it.
    Prompt must return: {"found": true/false, "x": int, "y": int}
    Returns True if clicked successfully.
    """
    img, bounds = activate_and_screenshot(win)
    try:
        raw  = ask_claude(img, prompt, model=model)
        data = parse_json(raw)
        if data.get("found"):
            ax, ay = img_to_screen(bounds, img, data["x"], data["y"])
            print(f"      [{label}] img({data['x']},{data['y']}) -> screen({ax},{ay})")
            pyautogui.click(ax, ay)
            time.sleep(delay)
            return True
    except Exception as e:
        print(f"      [{label} error: {e}]")
    print(f"      [{label}] not found")
    return False

# ── GESTURE HELPERS ───────────────────────────────────────────────────────────
def _gesture(win, x1, y1, x2, y2, duration=0.5, settle=1.2):
    """
    Generic drag gesture using pyautogui.dragTo.
    All coordinates are in logical screen pixels (already DPI-corrected by caller).
    """
    try:
        win.activate()
    except Exception:
        pass
    time.sleep(0.3)
    pyautogui.moveTo(x1, y1, duration=0.1)
    pyautogui.dragTo(x2, y2, duration=duration, button="left")
    time.sleep(settle)

def swipe_one_card(win):
    """
    Step 7: Swipe left by approximately one card width to advance to the next match.
    4 cards are visible across ~80% of window width, so 1 card ≈ 20%.
    We use 22% to ensure we advance at least one card without skipping two.
    """
    x_start = win.left + int(win.width * 0.72)
    x_end   = win.left + int(win.width * 0.50)   # 22% shift ≈ 1 card
    y       = win.top  + int(win.height * 0.48)
    print(f"      [swipe-1-card] ({x_start},{y}) -> ({x_end},{y})")
    _gesture(win, x_start, y, x_end, y, duration=0.4, settle=0.9)

def scroll_leaderboard_down(win):
    """
    Step 9: Scroll down on the leaderboard to reveal the next batch of players.
    Drags from lower-center to upper-center of the player list area.
    """
    x       = win.left + int(win.width  * 0.65)
    y_start = win.top  + int(win.height * 0.68)
    y_end   = win.top  + int(win.height * 0.28)
    print(f"      [scroll-down] ({x},{y_start}) -> ({x},{y_end})")
    _gesture(win, x, y_start, x, y_end, duration=0.5, settle=1.5)

# ── NAVIGATION PROMPTS ────────────────────────────────────────────────────────
NAV_TO_LEADERBOARD_PROMPT = """
You are helping navigate to the Mobile Legends Global Leaderboard.
Look at this screenshot and return the single element to tap to reach:
Leaderboard > Global (ranked list of top players with rank numbers like #1, #2, #3).

Return ONLY JSON:
{"screen": "<brief>", "on_leaderboard": <true if ranked player list visible>, "tap": {"x": <x>, "y": <y>}, "tap_label": "<label>"}
Set "on_leaderboard": true if already there. Set "tap": null if stuck.
""".strip()

IS_ON_LEADERBOARD_PROMPT = """
Is this screen showing the MLBB Global Leaderboard — a ranked list of players with rank numbers (#1, #2, #3...)?
Return ONLY JSON: {"on_leaderboard": true} or {"on_leaderboard": false}
""".strip()

LIST_PLAYERS_PROMPT = """
This is the MLBB Global Leaderboard. List all fully visible player rows.
Return ONLY a JSON array:
[{"rank": <int>, "name": "<player IGN>"}]
Player names may contain unicode/special characters. If none visible: []
""".strip()

FIND_BACK_PROMPT = """
Find the back arrow button (a left-pointing arrow at the top-left of the screen).
Return ONLY JSON: {"found": true, "x": <x>, "y": <y>}
If not found: {"found": false}
""".strip()

# Step 2: mini panel "Check" button
FIND_CHECK_PROMPT = """
A player profile panel has opened on the right side of the screen.
Find the "Check" button (labeled "Check", usually a teal/blue button near the bottom of the panel).
Return ONLY JSON: {"found": true, "x": <x>, "y": <y>}
If not found: {"found": false}
""".strip()

# Step 3: History tab in left sidebar
FIND_HISTORY_PROMPT = """
You are on an MLBB player profile page.
Find the "History" tab or menu item in the left sidebar and return its coordinates.
Return ONLY JSON: {"found": true, "x": <x>, "y": <y>}
If not found: {"found": false}
""".strip()

# Step 6: Quit button on match result screen
FIND_QUIT_PROMPT = """
You are on an MLBB match result / scoreboard screen.
Find the "Quit" button (usually a blue/teal button at the bottom-right corner).
Return ONLY JSON: {"found": true, "x": <x>, "y": <y>}
If not found: {"found": false}
""".strip()

def make_find_player_prompt(name, rank):
    return (
        f'You are on the MLBB Global Leaderboard.\n'
        f'Find the row for player "{name}" (rank #{rank}) and return its center coordinates.\n'
        f'Player names may contain unicode/special characters.\n'
        f'Return ONLY JSON: {{"found": true, "x": <x>, "y": <y>}}\n'
        f'If not visible: {{"found": false}}'
    )

def make_match_card_prompt(pos):
    """pos is 0-indexed position from left within the currently visible cards."""
    labels = ["first (leftmost)", "second from left", "third from left", "fourth from left"]
    label  = labels[pos] if pos < len(labels) else f"#{pos+1} from left"
    return (
        f'You are on an MLBB player\'s match History page showing horizontal match cards.\n'
        f'Find the {label} match card (a Victory/Defeat tile showing a hero portrait) and return its center.\n'
        f'Return ONLY JSON: {{"found": true, "x": <x>, "y": <y>}}\n'
        f'If not found: {{"found": false}}'
    )

def make_extract_match_prompt(player_name):
    return (
        f'This is an MLBB post-game scoreboard showing all 10 players.\n'
        f'The player we are tracking is "{player_name}".\n\n'
        f'Extract:\n'
        f'- result: "Victory" or "Defeat" (large text at the top)\n'
        f'- hero: hero name used by {player_name}\n'
        f'- kills, deaths, assists: KDA integers for {player_name}\n'
        f'- duration: match duration at top-right (e.g. "08:49")\n'
        f'- battle_id: the BattleID shown at the very bottom of the screen\n'
        f'- enemies: all 5 opponent players with name and hero\n\n'
        f'Return ONLY JSON:\n'
        f'{{\n'
        f'  "result": "Victory",\n'
        f'  "hero": "<hero name>",\n'
        f'  "kills": 0, "deaths": 0, "assists": 0,\n'
        f'  "duration": "<mm:ss>",\n'
        f'  "battle_id": "<id>",\n'
        f'  "enemies": [{{"name": "<name>", "hero": "<hero>"}}]\n'
        f'}}'
    )

# ── NAVIGATION ────────────────────────────────────────────────────────────────
def navigate_to_leaderboard(win):
    print("  Navigating to Global Leaderboard via Claude Vision...")
    for step in range(1, NAV_MAX_STEPS + 1):
        img, bounds = activate_and_screenshot(win)
        try:
            raw = ask_claude(img, NAV_TO_LEADERBOARD_PROMPT, model="claude-opus-4-6", max_tokens=300)
            nav = parse_json(raw)
        except Exception as e:
            print(f"    Step {step}: nav error ({e}) — retrying")
            time.sleep(2)
            continue

        if nav.get("on_leaderboard"):
            print(f"    Step {step}: on leaderboard")
            return True

        tap   = nav.get("tap")
        label = nav.get("tap_label", "?")
        if not tap:
            print(f"    Step {step}: stuck on '{nav.get('screen','?')}'")
            return False

        ax, ay = img_to_screen(bounds, img, tap["x"], tap["y"])
        print(f"    Step {step}: '{nav.get('screen','?')}' -> '{label}' img({tap['x']},{tap['y']}) -> screen({ax},{ay})")
        pyautogui.click(ax, ay)
        time.sleep(2.5)

    print("  Could not reach leaderboard after max steps.")
    return False

def go_back(win):
    """Step 8: Click the ← back button."""
    return click_element(win, FIND_BACK_PROMPT, label="back", delay=2.0)

def return_to_leaderboard(win):
    """
    Step 8: Press back until we confirm we're on the leaderboard.
    Handles variable depth (e.g. match-detail -> history -> profile -> leaderboard).
    Max 4 back presses to avoid getting stuck.
    """
    for attempt in range(4):
        img, _ = activate_and_screenshot(win)
        try:
            raw  = ask_claude(img, IS_ON_LEADERBOARD_PROMPT, max_tokens=60)
            data = parse_json(raw)
            if data.get("on_leaderboard"):
                print(f"      [return] on leaderboard after {attempt} back press(es)")
                return True
        except Exception:
            pass
        print(f"      [return] pressing back (attempt {attempt + 1})")
        go_back(win)
    return False

# ── PER-PLAYER 5-STEP COLLECTION ──────────────────────────────────────────────
def extract_match(win, player_name):
    img, _ = activate_and_screenshot(win)
    try:
        raw  = ask_claude(img, make_extract_match_prompt(player_name), model="claude-opus-4-6", max_tokens=1024)
        data = parse_json(raw)
        return data
    except Exception as e:
        print(f"      [extract match error: {e}]")
        return None

def collect_player_matches(win, player_name, rank):
    """
    Full 9-step flow for one player. Returns a list of match dicts.

    Steps inside this function:
      1  Click player row   -> mini panel opens
      2  Click Check        -> full profile page
      3  Click History      -> history cards page
      4  Click match card N -> match detail screen
      5  Extract data
      6  Click Quit         -> back to history cards
      7  Swipe left every CARDS_PER_SWIPE matches to reveal more
      (repeat 4-7 for MATCHES_PER_PLAYER matches)
      8  Press back until leaderboard confirmed
    """
    matches = []

    # ── Step 1: click player row ──────────────────────────────────────────────
    print(f"    [1] Finding row for {player_name} (#{rank})")
    if not click_element(win, make_find_player_prompt(player_name, rank),
                         label=f"row:{player_name}", delay=1.5):
        return []

    # ── Step 2: click Check ───────────────────────────────────────────────────
    print(f"    [2] Clicking Check")
    if not click_element(win, FIND_CHECK_PROMPT, label="Check", delay=2.5):
        # mini panel may be open but Check not found — dismiss
        return_to_leaderboard(win)
        return []

    # ── Step 3: click History ─────────────────────────────────────────────────
    print(f"    [3] Clicking History")
    if not click_element(win, FIND_HISTORY_PROMPT, label="History", delay=2.0):
        return_to_leaderboard(win)
        return []

    # ── Steps 4-7: collect up to MATCHES_PER_PLAYER unique matches ──────────
    # Strategy:
    #   • Always click the LEFTMOST card (position 0)
    #   • Swipe left by ONE card width after each match to advance
    #   • De-duplicate by battle_id — guarantees no duplicates
    #   • 3 consecutive duplicate battle_ids → history exhausted, stop early
    seen_ids    = set()   # battle_ids already collected
    dupe_streak = 0       # consecutive duplicates in a row
    MAX_DUPES   = 3       # stop when we keep seeing the same match

    for i in range(MATCHES_PER_PLAYER * 2):   # allow extra iterations to handle dupes
        if len(matches) >= MATCHES_PER_PLAYER:
            break

        print(f"    [4] Clicking leftmost card (collected {len(matches)}/{MATCHES_PER_PLAYER})")
        if not click_element(win, make_match_card_prompt(0), label="card", delay=2.5):
            print(f"      no card found — stopping")
            break

        # Step 5: extract
        print(f"    [5] Extracting")
        match_data = extract_match(win, player_name)
        bid = (match_data or {}).get("battle_id", "").strip()

        if bid and bid in seen_ids:
            # Duplicate — swipe further to skip past it
            dupe_streak += 1
            print(f"        DUPE BID:{bid} (streak {dupe_streak}/{MAX_DUPES})")
            click_element(win, FIND_QUIT_PROMPT, label="Quit-dupe", delay=1.5) or go_back(win)
            if dupe_streak >= MAX_DUPES:
                print(f"      History exhausted after {len(matches)} matches")
                break
            # Extra swipe to push past the stuck card
            swipe_one_card(win)
            swipe_one_card(win)
            continue

        dupe_streak = 0
        if match_data:
            if bid:
                seen_ids.add(bid)
            matches.append(match_data)
            hero   = match_data.get("hero",   "?")
            result = match_data.get("result",  "?")
            print(f"        NEW [{len(matches)}] {result} | {hero} | BID:{bid or '?'}")

        # Step 6: Quit → back to history cards
        print(f"    [6] Clicking Quit")
        if not click_element(win, FIND_QUIT_PROMPT, label="Quit", delay=2.0):
            go_back(win)

        # Step 7: swipe left ONE card to advance (skip if last match)
        if len(matches) < MATCHES_PER_PLAYER:
            print(f"    [7] Swiping to next card")
            swipe_one_card(win)

    # ── Step 8: return to leaderboard ─────────────────────────────────────────
    print(f"    [8] Returning to leaderboard")
    return_to_leaderboard(win)

    return matches

# ── LEADERBOARD HELPERS ───────────────────────────────────────────────────────
def list_players_on_screen(win):
    img, _ = activate_and_screenshot(win)
    try:
        raw  = ask_claude(img, LIST_PLAYERS_PROMPT, model="claude-haiku-4-5-20251001")
        data = parse_json(raw)
        if isinstance(data, list):
            return data
    except Exception as e:
        print(f"    [list players error: {e}]")
    return []

# ── AGGREGATION ───────────────────────────────────────────────────────────────
def dedup_matches(matches):
    """Remove duplicate matches by battle_id (last-write-wins for empty ids)."""
    seen, result = set(), []
    for m in matches:
        bid = (m.get("battle_id") or "").strip()
        if bid:
            if bid not in seen:
                seen.add(bid)
                result.append(m)
        else:
            result.append(m)   # no battle_id — keep it, can't de-dupe
    return result

def aggregate(player_records):
    """Build per-hero stats from collected match history."""
    hero_stats = {}
    for pr in player_records:
        pr["matches"] = dedup_matches(pr.get("matches", []))  # final safety dedup
        seen_heroes = set()
        for m in pr.get("matches", []):
            hero = (m.get("hero") or "").strip()
            if not hero:
                continue
            if hero not in hero_stats:
                hero_stats[hero] = {"hero": hero, "appearances": 0, "wins": 0, "players": []}
            hero_stats[hero]["appearances"] += 1
            if m.get("result") == "Victory":
                hero_stats[hero]["wins"] += 1
            seen_heroes.add(hero)
        for hero in seen_heroes:
            hero_stats[hero]["players"].append(pr["name"])

    result = []
    for hero, d in hero_stats.items():
        apps = d["appearances"]
        wr   = round(d["wins"] / apps, 4) if apps else None
        result.append({
            "hero":         hero,
            "top100_users": len(set(d["players"])),
            "appearances":  apps,
            "avg_win_rate": wr,   # kept for warr.gg front-end compatibility
            "win_rate":     wr,
            "players":      sorted(set(d["players"])),
        })
    return sorted(result, key=lambda h: h["appearances"], reverse=True)

# ── SUPABASE UPLOAD ───────────────────────────────────────────────────────────
def upload_to_supabase(heroes, player_records):
    today   = datetime.date.today().isoformat()
    payload = json.dumps({
        "scraped_at":    today,
        "total_players": len(player_records),
        "heroes":        heroes,
        "raw":           player_records,
    }).encode("utf-8")

    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/top100_snapshots"
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey":        SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    })
    try:
        with urllib.request.urlopen(req) as resp:
            print(f"  Uploaded to Supabase (date: {today}, status: {resp.status})")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  Supabase upload failed: {e.code} — {body}")
        return False
    except Exception as e:
        print(f"  Supabase upload error: {e}")
        return False

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print()
    print("=" * 46)
    print("  MLBB Top 100 Scraper -- warr.gg")
    print(f"  {datetime.datetime.now().strftime('%Y-%m-%d  %H:%M:%S')}")
    print(f"  {MATCHES_PER_PLAYER} matches/player  |  max {MAX_PLAYERS} players")
    print("=" * 46)
    print()

    # Validate config
    missing = [k for k, v in [
        ("ANTHROPIC_API_KEY",    ANTHROPIC_API_KEY),
        ("SUPABASE_URL",         SUPABASE_URL),
        ("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY),
    ] if v.startswith("YOUR_")]
    if missing:
        print(f"ERROR: Missing config: {', '.join(missing)}")
        print("Set them as environment variables or edit config.json.")
        sys.exit(1)

    # Get / launch BlueStacks
    print("[ 1/4 ] Finding BlueStacks...")
    win = get_window()
    if not win:
        print("ERROR: Could not open BlueStacks.")
        sys.exit(1)
    print(f"  Window: \"{win.title}\" ({win.width}x{win.height})")

    # Navigate to Global Leaderboard
    print()
    print("[ 2/4 ] Navigating to Global Leaderboard...")
    if not navigate_to_leaderboard(win):
        print("ERROR: Could not reach leaderboard. Open it manually and re-run.")
        sys.exit(1)

    # Collect per-player data
    print()
    print("[ 3/4 ] Collecting player match data...")

    player_records  = []
    processed_names = set()
    scroll_misses   = 0

    while len(player_records) < MAX_PLAYERS:
        players = list_players_on_screen(win)
        new_players = [p for p in players if p.get("name") and p["name"] not in processed_names]

        if not new_players:
            # Step 9: no new players visible — scroll down to reveal more
            scroll_misses += 1
            if scroll_misses >= MAX_SCROLL_MISSES:
                print("  No new players after several scrolls — end of leaderboard.")
                break
            print(f"\n  [9] Scrolling down leaderboard (miss {scroll_misses}/{MAX_SCROLL_MISSES})")
            scroll_leaderboard_down(win)
            continue

        scroll_misses = 0
        print(f"\n  {len(new_players)} new player(s) visible  (collected so far: {len(player_records)})")

        for p in new_players:
            if len(player_records) >= MAX_PLAYERS:
                break

            name = p["name"]
            rank = p.get("rank", "?")
            print(f"\n  Player #{rank}: {name}")

            matches = collect_player_matches(win, name, rank)
            player_records.append({"rank": rank, "name": name, "matches": matches})
            processed_names.add(name)
            print(f"  -> {len(matches)} match(es)  (total players: {len(player_records)})")

            # Save progress after each player — crash-safe
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "generated_at":  datetime.datetime.now().isoformat(),
                    "total_players": len(player_records),
                    "heroes":        aggregate(player_records),
                    "raw":           player_records,
                }, f, indent=2, ensure_ascii=False)

        # Step 9: after processing this batch, scroll down for the next batch
        if len(player_records) < MAX_PLAYERS:
            print(f"\n  [9] Scrolling down for next players")
            scroll_leaderboard_down(win)

    # Final aggregate + upload
    print()
    print(f"[ 4/4 ] Aggregating and uploading ({len(player_records)} players)...")
    heroes = aggregate(player_records)

    output = {
        "generated_at":  datetime.datetime.now().isoformat(),
        "total_players": len(player_records),
        "heroes":        heroes,
        "raw":           player_records,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"  Local backup saved -> {OUTPUT_FILE}")

    upload_to_supabase(heroes, player_records)

    # Summary table
    print()
    print("Top 10 heroes in recent top-100 matches:")
    print(f"  {'Hero':<18} {'Users':>5}  {'Apps':>4}  {'WR':>6}")
    print(f"  {'-'*18}  {'-'*5}  {'-'*4}  {'-'*6}")
    for h in heroes[:10]:
        wr = f"{h['avg_win_rate']*100:.1f}%" if h.get("avg_win_rate") is not None else "--"
        print(f"  {h['hero']:<18} {h['top100_users']:>5}  {h['appearances']:>4}  {wr:>6}")
    print()
    print("Done.")


if __name__ == "__main__":
    main()
