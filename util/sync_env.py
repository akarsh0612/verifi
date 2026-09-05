#!/usr/bin/env python3
"""
Verifi - Environment Sync Script
Reads the root .env file and compiles extension/config.js
so the Chrome Extension can automatically load API keys.
"""

import sys
from pathlib import Path


def parse_env_file(filepath: Path) -> dict:
    env_vars = {}
    if not filepath.exists():
        return env_vars

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue

            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip()

            # Remove enclosing quotes if present
            if (val.startswith('"') and val.endswith('"')) or (
                val.startswith("'") and val.endswith("'")
            ):
                val = val[1:-1]

            env_vars[key] = val

    return env_vars


def generate_config_js(env_vars: dict, target_file: Path):
    groq_api_key = env_vars.get("GROQ_API_KEY", "").strip()
    gemini_api_key = env_vars.get("GEMINI_API_KEY", "").strip()
    groq_model = env_vars.get("GROQ_MODEL", "groq/compound-mini").strip()
    gemini_model = env_vars.get("GEMINI_MODEL", "gemini-3.5-flash").strip()

    enable_grounding_raw = env_vars.get("ENABLE_SEARCH_GROUNDING", "false").lower()
    enable_grounding = "true" if enable_grounding_raw in ["true", "1", "yes"] else "false"

    try:
        pacing_delay = int(env_vars.get("PACING_DELAY", "6000"))
    except ValueError:
        pacing_delay = 6000

    try:
        batch_size = int(env_vars.get("BATCH_SIZE", "8"))
    except ValueError:
        batch_size = 8

    content = f"""/**
 * Verifi - Runtime Extension Configuration
 * Auto-generated from .env by util/sync_env.py
 * DO NOT commit actual API keys to version control.
 */

const CONFIG = {{
  GROQ_API_KEY: {repr(groq_api_key)},
  GEMINI_API_KEY: {repr(gemini_api_key)},
  GROQ_MODEL: {repr(groq_model or 'groq/compound-mini')},
  GEMINI_MODEL: {repr(gemini_model or 'gemini-3.5-flash')},
  ENABLE_SEARCH_GROUNDING: {enable_grounding},
  PACING_DELAY: {pacing_delay},
  BATCH_SIZE: {batch_size}
}};

// Expose in Service Worker and window contexts
if (typeof self !== 'undefined') {{
  self.CONFIG = CONFIG;
}}
if (typeof window !== 'undefined') {{
  window.CONFIG = CONFIG;
}}
"""
    target_file.parent.mkdir(parents=True, exist_ok=True)
    with open(target_file, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    root_dir = Path(__file__).resolve().parent.parent
    env_file = root_dir / ".env"
    example_env = root_dir / ".env.example"
    config_file = root_dir / "extension" / "config.js"

    if not env_file.exists():
        if example_env.exists():
            print(f"[Verifi] .env not found. Creating from .env.example...")
            with open(example_env, "r", encoding="utf-8") as src, open(
                env_file, "w", encoding="utf-8"
            ) as dst:
                dst.write(src.read())
        else:
            print(f"[Verifi] Warning: .env file not found at {env_file}")

    env_vars = parse_env_file(env_file)
    generate_config_js(env_vars, config_file)

    has_groq = bool(env_vars.get("GROQ_API_KEY", "").strip())
    has_gemini = bool(env_vars.get("GEMINI_API_KEY", "").strip())

    print("==================================================")
    print("  Verifi - Environment Sync Completed")
    print("==================================================")
    print(f" Source: {env_file}")
    print(f" Target: {config_file}")
    print(f" - GROQ_API_KEY:   {'[Configured]' if has_groq else '[Not set - edit .env]'}")
    print(f" - GEMINI_API_KEY: {'[Configured]' if has_gemini else '[Not set - edit .env]'}")
    print(f" - GROQ_MODEL:     {env_vars.get('GROQ_MODEL', 'groq/compound-mini')}")
    print(f" - GEMINI_MODEL:   {env_vars.get('GEMINI_MODEL', 'gemini-3.5-flash')}")
    print("==================================================")
    print(" Tip: Open chrome://extensions and click reload to apply updates.")
    print("==================================================")


if __name__ == "__main__":
    main()
