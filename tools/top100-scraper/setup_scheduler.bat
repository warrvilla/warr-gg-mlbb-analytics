@echo off
:: MLBB Top 100 Scraper — Task Scheduler Setup
:: Run this ONCE as Administrator to schedule the daily scrape at 3:00 AM

echo.
echo  Setting up daily MLBB Top 100 scrape at 3:00 AM...
echo.

:: Set your credentials here before running
set ANTHROPIC_KEY=YOUR_ANTHROPIC_KEY
set SUPABASE_URL=YOUR_SUPABASE_URL
set SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY

:: Path to this folder (auto-detected)
set SCRIPT_DIR=%~dp0
set SCRIPT_PATH=%SCRIPT_DIR%scraper.py

:: Create a wrapper .bat that sets env vars and runs the script
set RUNNER=%SCRIPT_DIR%run_scraper.bat
echo @echo off > "%RUNNER%"
echo set ANTHROPIC_API_KEY=%ANTHROPIC_KEY% >> "%RUNNER%"
echo set SUPABASE_URL=%SUPABASE_URL% >> "%RUNNER%"
echo set SUPABASE_SERVICE_KEY=%SUPABASE_KEY% >> "%RUNNER%"
echo python "%SCRIPT_PATH%" >> "%RUNNER%"
echo pause >> "%RUNNER%"

:: Register with Windows Task Scheduler
schtasks /create ^
  /tn "MLBB_Top100_Scraper" ^
  /tr "\"%RUNNER%\"" ^
  /sc DAILY ^
  /st 03:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f

if %errorlevel% equ 0 (
    echo.
    echo  SUCCESS: Task scheduled for 3:00 AM every day.
    echo.
    echo  To change the time: Task Scheduler ^> MLBB_Top100_Scraper ^> Properties
    echo  To run it now:      schtasks /run /tn "MLBB_Top100_Scraper"
    echo  To remove it:       schtasks /delete /tn "MLBB_Top100_Scraper" /f
    echo.
) else (
    echo.
    echo  ERROR: Could not create scheduled task.
    echo  Make sure you right-clicked and chose "Run as Administrator".
    echo.
)
pause
