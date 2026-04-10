@echo off
echo =============================================
echo  Building MLBB Top 100 Scraper .exe
echo  warr.gg
echo =============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.9+ from python.org
    pause
    exit /b 1
)

:: Install dependencies
echo Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)

echo.
echo Building .exe with PyInstaller...
echo (This takes about 1-2 minutes)
echo.

pyinstaller ^
    --onefile ^
    --windowed ^
    --name "MLBB_Top100_Scraper" ^
    --add-data "scraper.py;." ^
    --hidden-import "pygetwindow" ^
    --hidden-import "pyautogui" ^
    --hidden-import "PIL" ^
    --hidden-import "anthropic" ^
    app.py

if errorlevel 1 (
    echo.
    echo ERROR: Build failed. See output above.
    pause
    exit /b 1
)

echo.
echo =============================================
echo  BUILD COMPLETE
echo  Your app is at: dist\MLBB_Top100_Scraper.exe
echo  Double-click that file to run.
echo =============================================
echo.

:: Copy the .exe up one level for easy access
copy "dist\MLBB_Top100_Scraper.exe" "..\MLBB_Top100_Scraper.exe" >nul 2>&1
if not errorlevel 1 (
    echo Also copied to: tools\MLBB_Top100_Scraper.exe
)

pause
