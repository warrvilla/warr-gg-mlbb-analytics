"""
MLBB Top 100 Scraper — warr.gg Desktop App
==========================================
Double-click to run. No command line needed.

First time: fill in your API keys and click Save Config.
Then click Run Scraper whenever you want fresh data.
Use "Schedule Daily" to run it automatically every night.
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import threading
import subprocess
import sys
import os
import json
import datetime
from PIL import Image, ImageDraw, ImageTk
import pygetwindow as gw
from PIL import ImageGrab

# ── Config file lives next to this script ────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE  = os.path.join(SCRIPT_DIR, "config.json")
SCRAPER_PY   = os.path.join(SCRIPT_DIR, "scraper.py")
COORD_MAP_FILE = os.path.join(SCRIPT_DIR, "coord_map.json")

BLUESTACKS_TITLES = ["BlueStacks App Player", "BlueStacks 5", "BlueStacks", "HD-Player"]

def find_bluestacks():
    for title in BLUESTACKS_TITLES:
        wins = gw.getWindowsWithTitle(title)
        if wins:
            return wins[0]
    return None

DARK_BG   = "#0D0D14"
SURFACE   = "#141420"
SURFACE2  = "#1C1C2A"
BORDER    = "#2A2A3C"
ACCENT    = "#4F8EF7"
GREEN     = "#34D399"
RED       = "#F87171"
GOLD      = "#FBBF24"
TEXT      = "#F0F0F8"
TEXT2     = "#8888AA"
TEXT3     = "#55557A"

# ── Load / save config ────────────────────────────────────────────────────────
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {"anthropic_key": "", "supabase_url": "", "supabase_key": "", "bluestacks_exe": r"C:\Program Files\BlueStacks_nxt\HD-Player.exe"}

def save_config(cfg):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)

# ── Main App ──────────────────────────────────────────────────────────────────
class ScraperApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MLBB Top 100 Scraper — warr.gg")
        self.geometry("680x780")
        self.minsize(560, 600)
        self.configure(bg=DARK_BG)
        self.resizable(True, True)

        self._cfg = load_config()
        self._running = False
        self._proc = None

        self._build_ui()
        self._load_fields()

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Header
        hdr = tk.Frame(self, bg=SURFACE, pady=14)
        hdr.pack(fill="x")
        tk.Label(hdr, text="MLBB Top 100 Scraper", font=("Segoe UI", 16, "bold"),
                 bg=SURFACE, fg=TEXT).pack()
        tk.Label(hdr, text="warr.gg  ·  Powered by Claude Vision + BlueStacks",
                 font=("Segoe UI", 9), bg=SURFACE, fg=TEXT3).pack(pady=(2, 0))

        sep = tk.Frame(self, bg=BORDER, height=1)
        sep.pack(fill="x")

        # Scrollable body
        body = tk.Frame(self, bg=DARK_BG)
        body.pack(fill="both", expand=True, padx=20, pady=16)

        # ── Config section ────────────────────────────────────────────────────
        self._section(body, "API KEYS & SETTINGS")

        self._anth_var   = tk.StringVar()
        self._supa_url   = tk.StringVar()
        self._supa_key   = tk.StringVar()
        self._bs_exe     = tk.StringVar()
        self._debug_var  = tk.BooleanVar()

        self._field(body, "Anthropic API Key",    self._anth_var,  show="*")
        self._field(body, "Supabase URL",         self._supa_url)
        self._field(body, "Supabase Service Key", self._supa_key,  show="*")
        self._field(body, "BlueStacks .exe Path", self._bs_exe)

        dbg_row = tk.Frame(body, bg=DARK_BG)
        dbg_row.pack(fill="x", pady=(2, 4))
        tk.Checkbutton(
            dbg_row, text="Debug clicks (saves annotated PNG before each click — use to diagnose wrong clicks)",
            variable=self._debug_var, font=("Segoe UI", 9),
            bg=DARK_BG, fg=TEXT2, selectcolor=SURFACE2,
            activebackground=DARK_BG, activeforeground=TEXT,
        ).pack(side="left")

        btn_row = tk.Frame(body, bg=DARK_BG)
        btn_row.pack(fill="x", pady=(6, 0))
        self._btn(btn_row, "Save Config", self._save_cfg, color=ACCENT).pack(side="left")
        self._status_label = tk.Label(btn_row, text="", font=("Segoe UI", 9),
                                      bg=DARK_BG, fg=GREEN)
        self._status_label.pack(side="left", padx=10)

        tk.Frame(body, bg=BORDER, height=1).pack(fill="x", pady=14)

        # ── Run section ───────────────────────────────────────────────────────
        self._section(body, "RUN")

        desc = ("Launches BlueStacks, opens MLBB, navigates to the Global Leaderboard,\n"
                "reads all 100 players, and uploads a dated snapshot to Supabase.\n"
                "Your warr.gg top100 page will show the new data immediately.")
        tk.Label(body, text=desc, font=("Segoe UI", 9), bg=DARK_BG, fg=TEXT2,
                 justify="left", wraplength=600).pack(anchor="w", pady=(0, 10))

        run_row = tk.Frame(body, bg=DARK_BG)
        run_row.pack(fill="x")

        self._run_btn = self._btn(run_row, "  Run Scraper  ", self._run, color=GREEN, width=14)
        self._run_btn.pack(side="left")

        self._stop_btn = self._btn(run_row, "Stop", self._stop, color=RED, width=6)
        self._stop_btn.pack(side="left", padx=(8, 0))
        self._stop_btn.config(state="disabled")

        self._map_btn = self._btn(run_row, "Map Clicks", self._open_mapper, color=ACCENT)
        self._map_btn.pack(side="left", padx=(8, 0))

        self._sched_btn = self._btn(run_row, "Schedule Daily (3 AM)", self._schedule, color=GOLD)
        self._sched_btn.pack(side="right")

        # State chip
        self._state_chip = tk.Label(body, text="IDLE", font=("Segoe UI", 8, "bold"),
                                    bg=SURFACE2, fg=TEXT3, padx=8, pady=3,
                                    relief="flat", bd=0)
        self._state_chip.pack(anchor="w", pady=(8, 0))

        tk.Frame(body, bg=BORDER, height=1).pack(fill="x", pady=10)

        # ── Log section ───────────────────────────────────────────────────────
        self._section(body, "LOG")

        log_frame = tk.Frame(body, bg=SURFACE, bd=1, relief="flat",
                             highlightbackground=BORDER, highlightthickness=1)
        log_frame.pack(fill="both", expand=True)

        self._log = scrolledtext.ScrolledText(
            log_frame, font=("Consolas", 9), bg=SURFACE, fg=TEXT2,
            insertbackground=TEXT, relief="flat", bd=0,
            padx=10, pady=8, state="disabled", wrap="word"
        )
        self._log.pack(fill="both", expand=True)

        # Tag colours for log lines
        self._log.tag_config("info",    foreground=TEXT2)
        self._log.tag_config("ok",      foreground=GREEN)
        self._log.tag_config("warn",    foreground=GOLD)
        self._log.tag_config("error",   foreground=RED)
        self._log.tag_config("section", foreground=ACCENT, font=("Consolas", 9, "bold"))

        # Clear log button
        tk.Button(body, text="Clear log", font=("Segoe UI", 8), bg=SURFACE2, fg=TEXT3,
                  relief="flat", bd=0, cursor="hand2", activebackground=SURFACE,
                  command=self._clear_log).pack(anchor="e", pady=(4, 0))

    def _section(self, parent, text):
        tk.Label(parent, text=text, font=("Segoe UI", 8, "bold"),
                 bg=DARK_BG, fg=TEXT3, pady=0).pack(anchor="w", pady=(0, 6))

    def _field(self, parent, label, var, show=None):
        row = tk.Frame(parent, bg=DARK_BG)
        row.pack(fill="x", pady=(0, 6))
        tk.Label(row, text=label, font=("Segoe UI", 9), bg=DARK_BG, fg=TEXT2,
                 width=22, anchor="w").pack(side="left")
        kw = {"textvariable": var, "font": ("Segoe UI", 9),
              "bg": SURFACE2, "fg": TEXT, "insertbackground": TEXT,
              "relief": "flat", "bd": 0, "highlightthickness": 1,
              "highlightbackground": BORDER, "highlightcolor": ACCENT}
        if show:
            kw["show"] = show
        e = tk.Entry(row, **kw)
        e.pack(side="left", fill="x", expand=True, ipady=5, padx=(0, 0))

    def _btn(self, parent, text, cmd, color=ACCENT, width=None):
        kw = {"text": text, "command": cmd, "font": ("Segoe UI", 9, "bold"),
              "bg": color, "fg": DARK_BG, "relief": "flat", "bd": 0,
              "cursor": "hand2", "padx": 14, "pady": 6,
              "activebackground": color, "activeforeground": DARK_BG}
        if width:
            kw["width"] = width
        return tk.Button(parent, **kw)

    # ── Config ────────────────────────────────────────────────────────────────
    def _load_fields(self):
        self._anth_var.set(self._cfg.get("anthropic_key", ""))
        self._supa_url.set(self._cfg.get("supabase_url", ""))
        self._supa_key.set(self._cfg.get("supabase_key", ""))
        self._bs_exe.set(self._cfg.get("bluestacks_exe", r"C:\Program Files\BlueStacks_nxt\HD-Player.exe"))
        self._debug_var.set(bool(self._cfg.get("debug_clicks", False)))

    def _save_cfg(self):
        self._cfg["anthropic_key"]  = self._anth_var.get().strip()
        self._cfg["supabase_url"]   = self._supa_url.get().strip()
        self._cfg["supabase_key"]   = self._supa_key.get().strip()
        self._cfg["bluestacks_exe"] = self._bs_exe.get().strip()
        self._cfg["debug_clicks"]   = self._debug_var.get()
        save_config(self._cfg)
        self._status_label.config(text="Saved!", fg=GREEN)
        self.after(2000, lambda: self._status_label.config(text=""))

    # ── Run ───────────────────────────────────────────────────────────────────
    def _run(self):
        if self._running:
            return

        # Validate keys
        if not self._cfg.get("anthropic_key"):
            messagebox.showerror("Missing Key", "Save your Anthropic API key first.")
            return
        if not self._cfg.get("supabase_url") or not self._cfg.get("supabase_key"):
            messagebox.showerror("Missing Key", "Save your Supabase URL and Service Key first.")
            return

        self._running = True
        self._run_btn.config(state="disabled")
        self._stop_btn.config(state="normal")
        self._set_state("RUNNING", GREEN)
        self._log_line(f"── Starting scraper {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ──", "section")

        env = os.environ.copy()
        env["ANTHROPIC_API_KEY"]    = self._cfg["anthropic_key"]
        env["SUPABASE_URL"]         = self._cfg["supabase_url"]
        env["SUPABASE_SERVICE_KEY"] = self._cfg["supabase_key"]
        env["BLUESTACKS_EXE"]       = self._cfg.get("bluestacks_exe", "")

        def worker():
            try:
                self._proc = subprocess.Popen(
                    [sys.executable, SCRAPER_PY],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env=env,
                    cwd=SCRIPT_DIR,
                    bufsize=1,
                )
                for line in self._proc.stdout:
                    line = line.rstrip("\n")
                    tag = "ok" if any(x in line for x in ["✓","OK","Success","Uploaded","done"]) \
                        else "error" if any(x in line for x in ["Error","ERROR","Failed","failed","Traceback"]) \
                        else "warn" if any(x in line for x in ["Warning","WARN","Retrying","retrying"]) \
                        else "info"
                    self.after(0, self._log_line, line, tag)
                self._proc.wait()
                rc = self._proc.returncode
                if rc == 0:
                    self.after(0, self._log_line, "── Scraper finished successfully ──", "ok")
                    self.after(0, self._set_state, "DONE", GREEN)
                else:
                    self.after(0, self._log_line, f"── Scraper exited with code {rc} ──", "error")
                    self.after(0, self._set_state, "ERROR", RED)
            except Exception as e:
                self.after(0, self._log_line, f"Failed to start scraper: {e}", "error")
                self.after(0, self._set_state, "ERROR", RED)
            finally:
                self._running = False
                self._proc = None
                self.after(0, self._run_btn.config, {"state": "normal"})
                self.after(0, self._stop_btn.config, {"state": "disabled"})

        threading.Thread(target=worker, daemon=True).start()

    def _stop(self):
        if self._proc:
            self._proc.terminate()
            self._log_line("Stopped by user.", "warn")
            self._set_state("STOPPED", GOLD)

    # ── Schedule ──────────────────────────────────────────────────────────────
    def _schedule(self):
        bat = os.path.join(SCRIPT_DIR, "setup_scheduler.bat")
        if not os.path.exists(bat):
            messagebox.showerror("Not found", f"setup_scheduler.bat not found:\n{bat}")
            return
        if messagebox.askyesno("Schedule Daily",
            "This will create a Windows Task Scheduler job that runs\n"
            "the scraper every night at 3:00 AM.\n\n"
            "Make sure BlueStacks is installed and MLBB is set up.\n\n"
            "Continue?"):
            # Inject keys into env and run the bat
            env = os.environ.copy()
            env["ANTHROPIC_API_KEY"]    = self._cfg.get("anthropic_key", "")
            env["SUPABASE_URL"]         = self._cfg.get("supabase_url", "")
            env["SUPABASE_SERVICE_KEY"] = self._cfg.get("supabase_key", "")
            try:
                subprocess.run(["cmd", "/c", bat], env=env, cwd=SCRIPT_DIR, check=True)
                messagebox.showinfo("Done", "Daily schedule created!\nThe scraper will run at 3:00 AM every night.")
                self._log_line("Daily schedule registered with Task Scheduler.", "ok")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to create schedule:\n{e}")

    # ── Log helpers ───────────────────────────────────────────────────────────
    def _log_line(self, text, tag="info"):
        self._log.config(state="normal")
        self._log.insert("end", text + "\n", tag)
        self._log.see("end")
        self._log.config(state="disabled")

    def _clear_log(self):
        self._log.config(state="normal")
        self._log.delete("1.0", "end")
        self._log.config(state="disabled")

    def _set_state(self, text, color):
        self._state_chip.config(text=text, fg=color)

    def _open_mapper(self):
        MappingWizard(self)


# ── MAPPING WIZARD ────────────────────────────────────────────────────────────
class MappingWizard(tk.Toplevel):
    """
    Step-by-step coordinate mapper.
    For each UI element, you navigate BlueStacks to the right screen,
    click Capture, then click the element in the screenshot preview.
    Saves percentages to coord_map.json so the scraper never guesses.
    """

    STEPS = [
        ("check_button",
         "Step 1 — CHECK BUTTON\n\n"
         "On the leaderboard, click any player row so the mini profile panel\n"
         "opens on the right side of the screen.\n\n"
         "Click Capture, then click the blue CHECK button in that panel."),

        ("history_tab",
         "Step 2 — HISTORY TAB\n\n"
         "The Check button took you to the player's full profile page.\n"
         "You should see a left sidebar: Profile / Album / Collection / History / ...\n\n"
         "Click Capture, then click HISTORY in that sidebar."),

        ("match_card_0",
         "Step 3 — MATCH CARD  (1st from left)\n\n"
         "You are now on the player's History page showing horizontal match cards.\n\n"
         "Click Capture, then click the CENTER of the 1st (leftmost) match card."),

        ("match_card_1",
         "Step 4 — MATCH CARD  (2nd from left)\n\n"
         "Stay on the same History page.\n\n"
         "Click Capture, then click the CENTER of the 2nd match card."),

        ("match_card_2",
         "Step 5 — MATCH CARD  (3rd from left)\n\n"
         "Stay on the same History page.\n\n"
         "Click Capture, then click the CENTER of the 3rd match card."),

        ("match_card_3",
         "Step 6 — MATCH CARD  (4th from left)\n\n"
         "Stay on the same History page.\n\n"
         "Click Capture, then click the CENTER of the 4th match card."),

        ("quit_button",
         "Step 7 — QUIT BUTTON\n\n"
         "Click any match card to open the full match result / scoreboard screen.\n\n"
         "Click Capture, then click the QUIT button at the bottom-right."),

        ("back_arrow",
         "Step 8 — BACK ARROW  (←)\n\n"
         "The Quit button returned you to the History page.\n"
         "You should see the ← back arrow at the top-left of the screen.\n\n"
         "Click Capture, then click the ← arrow."),
    ]

    CANVAS_W = 1080
    CANVAS_H = 480

    def __init__(self, parent):
        super().__init__(parent)
        self.title("Click Mapper — warr.gg Scraper")
        self.geometry("1140x780")
        self.resizable(True, True)
        self.configure(bg=DARK_BG)
        self.grab_set()   # modal

        self._step      = 0
        self._coord_map = {}
        self._photo     = None   # keep reference so Tkinter doesn't GC it
        self._scale     = 1.0   # screenshot → canvas scale
        self._pending   = False  # waiting for a canvas click

        # Load existing map if present
        if os.path.exists(COORD_MAP_FILE):
            try:
                with open(COORD_MAP_FILE) as f:
                    self._coord_map = json.load(f)
            except Exception:
                pass

        self._build_ui()
        self._show_step()

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build_ui(self):
        # Header
        hdr = tk.Frame(self, bg=SURFACE, pady=10)
        hdr.pack(fill="x")
        tk.Label(hdr, text="Click Mapper", font=("Segoe UI", 14, "bold"),
                 bg=SURFACE, fg=TEXT).pack()
        tk.Label(hdr, text="Map each UI element once — the scraper will click exactly here every run.",
                 font=("Segoe UI", 9), bg=SURFACE, fg=TEXT3).pack(pady=(2, 0))

        tk.Frame(self, bg=BORDER, height=1).pack(fill="x")

        body = tk.Frame(self, bg=DARK_BG, padx=16, pady=12)
        body.pack(fill="both", expand=True)

        # Step indicator
        self._step_lbl = tk.Label(body, text="", font=("Segoe UI", 8, "bold"),
                                  bg=DARK_BG, fg=TEXT3)
        self._step_lbl.pack(anchor="w")

        # Instruction text
        self._instr = tk.Label(body, text="", font=("Segoe UI", 10),
                               bg=DARK_BG, fg=TEXT, justify="left", wraplength=860)
        self._instr.pack(anchor="w", pady=(4, 10))

        # Canvas (screenshot preview)
        canvas_frame = tk.Frame(body, bg=BORDER, padx=1, pady=1)
        canvas_frame.pack()
        self._canvas = tk.Canvas(canvas_frame, width=self.CANVAS_W, height=self.CANVAS_H,
                                 bg="#0A0A10", highlightthickness=0, cursor="crosshair")
        self._canvas.pack()
        self._canvas.bind("<Button-1>", self._on_canvas_click)

        self._hint_lbl = tk.Label(body, text="Click Capture to take a screenshot first.",
                                  font=("Segoe UI", 9, "italic"), bg=DARK_BG, fg=TEXT3)
        self._hint_lbl.pack(pady=(6, 0))

        # Buttons row
        btn_row = tk.Frame(body, bg=DARK_BG)
        btn_row.pack(pady=(10, 0))

        self._cap_btn = tk.Button(btn_row, text="Capture Screenshot", command=self._capture,
                                  font=("Segoe UI", 9, "bold"), bg=ACCENT, fg=DARK_BG,
                                  relief="flat", padx=14, pady=6, cursor="hand2")
        self._cap_btn.pack(side="left", padx=(0, 8))

        self._skip_btn = tk.Button(btn_row, text="Skip this step", command=self._next_step,
                                   font=("Segoe UI", 9), bg=SURFACE2, fg=TEXT2,
                                   relief="flat", padx=14, pady=6, cursor="hand2")
        self._skip_btn.pack(side="left", padx=(0, 8))

        self._done_btn = tk.Button(btn_row, text="Save & Close", command=self._save_and_close,
                                   font=("Segoe UI", 9, "bold"), bg=GREEN, fg=DARK_BG,
                                   relief="flat", padx=14, pady=6, cursor="hand2",
                                   state="disabled")
        self._done_btn.pack(side="left")

        # Progress dots
        dot_row = tk.Frame(body, bg=DARK_BG)
        dot_row.pack(pady=(14, 0))
        self._dots = []
        for i in range(len(self.STEPS)):
            d = tk.Label(dot_row, text="o", font=("Segoe UI", 10), bg=DARK_BG, fg=TEXT3)
            d.pack(side="left", padx=3)
            self._dots.append(d)

    # ── Steps ─────────────────────────────────────────────────────────────────
    def _show_step(self):
        if self._step >= len(self.STEPS):
            self._finish()
            return

        key, instr = self.STEPS[self._step]
        mapped     = key in self._coord_map

        self._step_lbl.config(
            text=f"Step {self._step + 1} of {len(self.STEPS)}  —  {key}"
                 + ("  [already mapped]" if mapped else ""))
        self._instr.config(text=instr)
        self._hint_lbl.config(text="Click Capture to take a screenshot, then click the element.",
                              fg=TEXT3)
        self._canvas.delete("all")
        self._pending = False

        # Update dots
        for i, d in enumerate(self._dots):
            if i < self._step:
                d.config(text="•", fg=GREEN)
            elif i == self._step:
                d.config(text="•", fg=ACCENT)
            else:
                d.config(text="o", fg=TEXT3)

    def _capture(self):
        """
        Hide this window, screenshot the full screen (so BlueStacks is visible),
        then restore. A cyan rectangle marks BlueStacks so you know where to click.
        Coordinates are stored relative to the BlueStacks window.
        """
        win = find_bluestacks()
        if not win:
            messagebox.showerror("BlueStacks not found",
                                 "BlueStacks is not running.\n"
                                 "Open BlueStacks and navigate to the correct screen first.",
                                 parent=self)
            return

        import time

        # Hide the wizard so it doesn't appear in the screenshot
        self.withdraw()
        self.update_idletasks()
        time.sleep(0.5)   # let the window fully disappear

        # Full screen screenshot (physical pixels)
        shot = ImageGrab.grab()

        # Restore the wizard
        self.deiconify()
        self.lift()

        # Logical screen size from Tkinter (matches pygetwindow's coordinate space)
        logical_screen_w = self.winfo_screenwidth()
        logical_screen_h = self.winfo_screenheight()

        # DPI scale factors: how many physical pixels per logical pixel
        self._dpi_x = shot.width  / logical_screen_w
        self._dpi_y = shot.height / logical_screen_h

        # BlueStacks window bounds in logical pixels (from pygetwindow)
        self._win_bounds = (win.left, win.top, win.width, win.height)

        # Scale full screenshot to fit canvas
        scale = min(self.CANVAS_W / shot.width, self.CANVAS_H / shot.height)
        self._scale = scale
        dw = int(shot.width  * scale)
        dh = int(shot.height * scale)
        display = shot.resize((dw, dh), Image.LANCZOS)

        # Draw cyan outline around BlueStacks window so user can see it
        draw = ImageDraw.Draw(display)
        bx1 = int(win.left  * self._dpi_x * scale)
        by1 = int(win.top   * self._dpi_y * scale)
        bx2 = int((win.left + win.width)  * self._dpi_x * scale)
        by2 = int((win.top  + win.height) * self._dpi_y * scale)
        draw.rectangle([bx1, by1, bx2, by2], outline="cyan", width=2)
        draw.text((bx1 + 6, by1 + 6), "BlueStacks — click inside here", fill="cyan")

        self._photo = ImageTk.PhotoImage(display)
        self._canvas.delete("all")
        off_x = (self.CANVAS_W - dw) // 2
        off_y = (self.CANVAS_H - dh) // 2
        self._canvas_offset = (off_x, off_y)
        self._canvas.create_image(off_x, off_y, anchor="nw", image=self._photo)

        self._pending = True
        self._hint_lbl.config(
            text="Full screen captured. Click the element inside the cyan BlueStacks outline.",
            fg=GOLD)

    def _on_canvas_click(self, event):
        if not self._pending:
            return

        off_x, off_y = self._canvas_offset

        # Canvas pixel → full-screen physical pixel
        phys_x = (event.x - off_x) / self._scale
        phys_y = (event.y - off_y) / self._scale

        # Physical pixel → logical screen coordinate (same space as pygetwindow)
        log_x = phys_x / self._dpi_x
        log_y = phys_y / self._dpi_y

        # Logical → position relative to BlueStacks window
        win_x, win_y, win_w, win_h = self._win_bounds
        rel_x = log_x - win_x
        rel_y = log_y - win_y

        # Store as percentage of BlueStacks window size (clamped to [0, 1])
        x_pct = max(0.0, min(rel_x / win_w, 1.0))
        y_pct = max(0.0, min(rel_y / win_h, 1.0))

        key = self.STEPS[self._step][0]
        self._coord_map[key] = {"x_pct": round(x_pct, 4), "y_pct": round(y_pct, 4)}

        # Draw red dot marker at click position
        r = 10
        self._canvas.create_oval(event.x-r, event.y-r, event.x+r, event.y+r,
                                  outline="red", width=3)
        self._canvas.create_oval(event.x-3, event.y-3, event.x+3, event.y+3,
                                  fill="red")
        self._canvas.create_text(event.x + r + 4, event.y,
                                  text=f"{key}  ({x_pct:.3f}, {y_pct:.3f})",
                                  fill="red", anchor="w", font=("Consolas", 9))

        self._pending = False
        self._hint_lbl.config(
            text=f"Mapped  {key}  at ({x_pct:.3f}, {y_pct:.3f}).  Advancing to next step...",
            fg=GREEN)

        self.after(800, self._next_step)

    def _next_step(self):
        self._step += 1
        if self._step >= len(self.STEPS):
            self._finish()
        else:
            self._show_step()

    def _finish(self):
        self._instr.config(
            text="All steps complete!\n\n"
                 f"Mapped {len(self._coord_map)} of {len(self.STEPS)} elements.\n"
                 "Click Save & Close to write coord_map.json.\n"
                 "The scraper will use these exact positions on every run.")
        self._step_lbl.config(text="Done")
        self._cap_btn.config(state="disabled")
        self._skip_btn.config(state="disabled")
        self._done_btn.config(state="normal")
        for d in self._dots:
            d.config(text="•", fg=GREEN)

    def _save_and_close(self):
        with open(COORD_MAP_FILE, "w") as f:
            json.dump(self._coord_map, f, indent=2)
        messagebox.showinfo("Saved",
                            f"coord_map.json saved with {len(self._coord_map)} mapped positions.\n"
                            "The scraper will now use these exact coordinates.",
                            parent=self)
        self.destroy()


if __name__ == "__main__":
    app = ScraperApp()
    app.mainloop()
