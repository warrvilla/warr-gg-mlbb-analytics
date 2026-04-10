@echo off
:: Quick launcher — runs the GUI app directly with Python.
:: Use this if you have Python installed and don't need the .exe

python --version >nul 2>&1
if errorlevel 1 (
    echo Python not found. Install from python.org then run this again.
    pause
    exit /b 1
)

:: Install deps silently on first run
pip install -r requirements.txt -q

:: Launch the GUI
python app.py
