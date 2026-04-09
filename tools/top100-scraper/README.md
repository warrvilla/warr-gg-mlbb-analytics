# MLBB Top 100 Scraper

Automatically reads the MLBB Global Top 100 leaderboard from BlueStacks using Claude Vision, then outputs a `top100_meta.json` file you can import into warr.gg.

## One-time setup (Windows)

**1. Install Python 3.10+**
Download from https://python.org — check "Add to PATH" during install.

**2. Install dependencies**
Open a terminal in this folder and run:
```
pip install -r requirements.txt
```

**3. Get your Anthropic API key**
Go to https://console.anthropic.com → API Keys → Create key.
Set it as an environment variable (recommended):
```
setx ANTHROPIC_API_KEY "sk-ant-..."
```
Or just paste it when the script asks.

---

## Every time you want fresh data

1. Open BlueStacks
2. Open Mobile Legends
3. Go to **Leaderboard → Global → Page 1** (the list of top ranked players showing hero + win rate)
4. Run the scraper:
```
python scraper.py
```
5. Press Enter when the script asks
6. It reads every page automatically, clicking next until done
7. `top100_meta.json` is created in this folder

---

## Output format

```json
{
  "generated_at": "2026-04-09T14:30:00",
  "total_players_scanned": 100,
  "heroes": [
    {
      "hero": "Chou",
      "top100_users": 12,
      "avg_win_rate": 0.681,
      "avg_games": 843,
      "players": [
        { "rank": 3, "name": "PlayerXYZ", "wr": 0.71, "games": 920 }
      ]
    }
  ],
  "raw": [ ... ]
}
```

---

## Troubleshooting

**"BlueStacks window not found"**
→ Make sure BlueStacks is open and NOT minimized. The script needs the window visible.

**Empty pages / no data extracted**
→ Make sure you are on the correct leaderboard screen (shows hero name + win rate per player).
→ Try increasing `PAGE_DELAY` in `scraper.py` (line 18) if your PC is slow.

**Script clicks the wrong spot**
→ The next-page button detection uses Claude Vision. If it misclicks, try resizing the BlueStacks window to a standard size (1280×720 or 1920×1080).

**Rate limit / API errors**
→ Increase `PAGE_DELAY` to 3-4 seconds.
