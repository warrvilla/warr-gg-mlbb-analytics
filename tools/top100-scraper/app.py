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

# ── Config file lives next to this script ────────────────────────────────────
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")
SCRAPER_PY  = os.path.join(SCRIPT_DIR, "scraper.py")

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


if __name__ == "__main__":
    app = ScraperApp()
    app.mainloop()
