# Team logos

Drop a square **webp** named after the team, lowercased with underscores:

| Team name        | File                         |
|------------------|------------------------------|
| Team Falcons PH  | `team_falcons_ph.webp`       |
| Blacklist        | `blacklist.webp`             |
| ECHO             | `echo.webp`                  |

The app resolves a logo via `WDB.teamLogo(name)`. If the file is missing,
the UI automatically falls back to a colored monogram — so logos can be
added gradually without any code changes.

Recommended: ~128×128 webp, transparent or dark background.
