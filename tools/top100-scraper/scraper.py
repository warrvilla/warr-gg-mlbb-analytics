#!/usr/bin/env python3
"""
MLBB Top 100 Global Scraper — warr.gg
======================================
Opens BlueStacks, reads the MLBB Global Leaderboard using Claude Vision,
navigates pages automatically, and outputs top100_meta.json.

Usage:
  1. pip install -r requirements.txt
  2. Set ANTHROPIC_API_KEY in your environment (or enter it when prompted)
  3. Open BlueStacks → MLBB → Leaderboard → Global Top 100 (first page visible)
  4. python scraper.py
"""

import os
import sys
import json
import time
import base64
import io
import re
import pyautogui
import pygetwindow as gw
from PIL import ImageGrab, Image
import anthropic

# ── CONFIG ────────────────────────────────────────────────────────────────────
OUTPUT_FILE     = "top100_meta.json"
MAX_PAGES       = 25       # safety cap — stops after this many pages
PAGE_DELAY      = 2.5      # seconds to wait after clicking next page
CLICK_DELAY     = 0.4      # seconds after window focus before screenshot
MAX_EMPTY_PAGES = 3        # stop after this many consecutive pages with no data

# BlueStacks window title variants (tries each in order)
BLUESTACKS_TITLES = [
    "BlueStacks App Player",
    "BlueStacks",
    "BlueStacks 5",
    "HD-Player",
]

# ── INIT ──────────────────────────────────────────────────────────────────────
api_key = os.environ.get("ANTHROPIC_API_KEY")
if not api_key:
    api_key = input("Anthropic API key: ").strip()
    if not api_key:
        print("ERROR: API key required.")
        sys.exit(1)

client = anthropic.Anthropic(api_key=api_key)

# ── WINDOW HELPERS ────────────────────────────────────────────────────────────
def find_bluestacks():
    for title in BLUESTACKS_TITLES:
        wins = gw.getWindowsWithTitle(title)
        if wins:
            return wins[0]
    return None

def activate_and_screenshot(win):
    """Bring window to front and capture it. Returns (PIL Image, (x, y, w, h))."""
    try:
        win.activate()
    except Exception:
        pass
    time.sleep(CLICK_DELAY)
    x, y, w, h = win.left, win.top, win.width, win.height
    img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
    return img, (x, y, w, h)

# ── VISION HELPERS ────────────────────────────────────────────────────────────
def to_base64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode()

def ask_claude(img: Image.Image, prompt: str, model="claude-opus-4-6", max_tokens=2048) -> str:
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": to_base64(img),
                    },
                },
                {"type": "text", "text": prompt},
            ],
        }],
    )
    return response.content[0].text.strip()

def parse_json_response(text: str):
    """Extract JSON from Claude's response even if wrapped in markdown."""
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    return json.loads(text.strip())

# ── EXTRACTION ────────────────────────────────────────────────────────────────
EXTRACT_PROMPT = """
This is a Mobile Legends Bang Bang Global Leaderboard screenshot.

Extract every visible player row as a JSON array. Each object must have:
{
  "rank":     <global rank integer, e.g. 1>,
  "player":   <player IGN string>,
  "hero":     <hero name string exactly as shown>,
  "win_rate": <win rate as a decimal float, e.g. 0.657 for 65.7%>,
  "games":    <total games played integer>
}

Rules:
- If win rate is shown as "65.7%" return 0.657
- If a field is not visible return null for that field
- Return ONLY a valid JSON array — no explanation, no markdown

If no leaderboard data is visible at all return: []
""".strip()

def extract_entries(img: Image.Image) -> list:
    try:
        raw = ask_claude(img, EXTRACT_PROMPT, model="claude-opus-4-6")
        data = parse_json_response(raw)
        if isinstance(data, list):
            return data
    except Exception as e:
        print(f"    [extract error: {e}]")
    return []

# ── NAVIGATION ────────────────────────────────────────────────────────────────
NAV_PROMPT = """
Find the NEXT PAGE button or right-arrow navigation button in this MLBB leaderboard.

Return ONLY JSON (no markdown):
{"found": true, "x": <x pixel in image>, "y": <y pixel in image>}

If there is no next-page button (last page or not a leaderboard screen):
{"found": false}

Coordinates must be relative to the image, not the screen.
""".strip()

def find_next_button(img: Image.Image) -> dict:
    try:
        raw = ask_claude(img, NAV_PROMPT, model="claude-haiku-4-5-20251001", max_tokens=100)
        return parse_json_response(raw)
    except Exception:
        return {"found": False}

def click_relative(bounds: tuple, rx: int, ry: int):
    """Click at image-relative (rx, ry) translated to absolute screen coords."""
    win_x, win_y, _, _ = bounds
    pyautogui.click(win_x + rx, win_y + ry)

# ── AGGREGATION ───────────────────────────────────────────────────────────────
def aggregate(entries: list) -> list:
    """Roll up raw player entries into per-hero stats."""
    stats = {}
    for e in entries:
        hero = (e.get("hero") or "").strip()
        if not hero:
            continue
        if hero not in stats:
            stats[hero] = {"hero": hero, "players": []}
        stats[hero]["players"].append({
            "rank":   e.get("rank"),
            "name":   e.get("player"),
            "wr":     e.get("win_rate"),
            "games":  e.get("games"),
        })

    result = []
    for hero, d in stats.items():
        players = d["players"]
        wrs   = [p["wr"]    for p in players if p["wr"]    is not None]
        games = [p["games"] for p in players if p["games"] is not None]
        result.append({
            "hero":          hero,
            "top100_users":  len(players),
            "avg_win_rate":  round(sum(wrs)   / len(wrs),   4) if wrs   else None,
            "avg_games":     round(sum(games) / len(games))    if games else None,
            "players":       sorted(players, key=lambda p: p["rank"] or 9999),
        })

    return sorted(result, key=lambda h: h["top100_users"], reverse=True)

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print()
    print("╔══════════════════════════════════════════╗")
    print("║   MLBB Top 100 Scraper — warr.gg         ║")
    print("╚══════════════════════════════════════════╝")
    print()
    print("Before you continue:")
    print("  1. BlueStacks is open and visible")
    print("  2. Mobile Legends is running")
    print("  3. You are on: Leaderboard → Global → Top 100 (Page 1)")
    print()
    input("Press Enter when ready → ")
    print()

    win = find_bluestacks()
    if not win:
        print("ERROR: BlueStacks window not found.")
        print("Make sure BlueStacks is running (not minimized).")
        sys.exit(1)

    print(f"✓ BlueStacks found: \"{win.title}\" ({win.width}×{win.height})")
    print()

    all_entries   = []
    seen_ranks    = set()
    empty_streak  = 0
    page          = 1

    while page <= MAX_PAGES:
        print(f"  Page {page:02d} — capturing... ", end="", flush=True)

        img, bounds = activate_and_screenshot(win)
        entries = extract_entries(img)

        # Deduplicate by rank
        new = []
        for e in entries:
            r = e.get("rank")
            if r is not None:
                if r not in seen_ranks:
                    seen_ranks.add(r)
                    new.append(e)
            else:
                new.append(e)   # no rank field — keep anyway

        if new:
            all_entries.extend(new)
            print(f"✓ {len(new)} players  (total: {len(all_entries)})")
            empty_streak = 0
        else:
            print("— no data")
            empty_streak += 1
            if empty_streak >= MAX_EMPTY_PAGES:
                print()
                print(f"  Stopped: {MAX_EMPTY_PAGES} consecutive empty pages.")
                break

        # Navigate to next page
        nav = find_next_button(img)
        if not nav.get("found"):
            print()
            print("  No more pages — done!")
            break

        click_relative(bounds, nav["x"], nav["y"])
        time.sleep(PAGE_DELAY)
        page += 1

    # ── Output ────────────────────────────────────────────────────────────────
    print()
    print(f"Scanned {len(all_entries)} unique player entries across {page} page(s).")
    print("Aggregating hero stats... ", end="", flush=True)

    hero_stats = aggregate(all_entries)
    print(f"✓  {len(hero_stats)} distinct heroes")
    print()

    output = {
        "generated_at":         time.strftime("%Y-%m-%dT%H:%M:%S"),
        "total_players_scanned": len(all_entries),
        "heroes":               hero_stats,
        "raw":                  all_entries,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"✅  Saved → {OUTPUT_FILE}")
    print()
    print("Top 10 heroes by usage in top 100 global:")
    print(f"  {'Hero':<18} {'Players':>7}   {'Avg WR':>7}   {'Avg Games':>10}")
    print(f"  {'─'*18}   {'─'*7}   {'─'*7}   {'─'*10}")
    for h in hero_stats[:10]:
        wr   = f"{h['avg_win_rate']*100:.1f}%" if h['avg_win_rate'] is not None else "  —"
        gms  = str(h['avg_games'])              if h['avg_games']   is not None else "—"
        print(f"  {h['hero']:<18} {h['top100_users']:>7}   {wr:>7}   {gms:>10}")
    print()

if __name__ == "__main__":
    main()
