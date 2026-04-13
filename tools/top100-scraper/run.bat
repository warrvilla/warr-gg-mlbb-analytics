@echo off
:: Quick launcher — runs the GUI app with no terminal window.

python --version >nul 2>&1
if errorlevel 1 (
    echo Python not found. Install from python.org then run this again.
    pause
    exit /b 1
)

:: Install deps silently on first run (needs a visible window briefly)
pip install -r requirements.txt -q

:: Launch the GUI without a terminal window (pythonw = no console)
start "" pythonw app.py
