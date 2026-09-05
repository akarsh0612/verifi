#!/usr/bin/env python3
"""
Verifi - Environment File Watcher
Automatically detects changes to .env and immediately compiles extension/config.js
Run this in the background while developing so you never have to manually sync!
"""

import time
import sys
from pathlib import Path

# Import sync functions from sync_env.py
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir / "util"))
from sync_env import parse_env_file, generate_config_js

def watch():
    env_file = root_dir / ".env"
    config_file = root_dir / "extension" / "config.js"

    print("==================================================")
    print("  Verifi - Automatic .env Watcher Active")
    print("==================================================")
    print(f" Watching: {env_file}")
    print(f" Output:   {config_file}")
    print(" Edit .env anytime - changes will auto-compile!")
    print(" Press Ctrl+C to stop watching.")
    print("==================================================")

    last_mtime = None
    if env_file.exists():
        last_mtime = env_file.stat().st_mtime
        env_vars = parse_env_file(env_file)
        generate_config_js(env_vars, config_file)

    while True:
        try:
            time.sleep(1)
            if env_file.exists():
                current_mtime = env_file.stat().st_mtime
                if last_mtime is None or current_mtime != last_mtime:
                    last_mtime = current_mtime
                    env_vars = parse_env_file(env_file)
                    generate_config_js(env_vars, config_file)
                    t = time.strftime("%H:%M:%S")
                    groq_ok = bool(env_vars.get("GROQ_API_KEY", "").strip())
                    gemini_ok = bool(env_vars.get("GEMINI_API_KEY", "").strip())
                    print(f"[{t}] ✓ .env updated! Compiled to config.js (Groq: {'Set' if groq_ok else 'Empty'}, Gemini: {'Set' if gemini_ok else 'Empty'})")
        except KeyboardInterrupt:
            print("\n[Verifi Watcher] Stopped.")
            break
        except Exception as e:
            print(f"[Verifi Watcher] Error: {e}")

if __name__ == "__main__":
    watch()
