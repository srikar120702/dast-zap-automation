"""Validate a profile + context pair and print the effective run (no ZAP calls)."""
import argparse, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dast.config import load_profile, load_context, resolve, ConfigError

env = Path(__file__).resolve().parents[1] / ".env"
for line in env.read_text().splitlines() if env.exists() else []:
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); os.environ.setdefault(k, v)

ap = argparse.ArgumentParser()
ap.add_argument("--profile", required=True); ap.add_argument("--context", required=True)
ap.add_argument("--mode"); ap.add_argument("--discovery"); ap.add_argument("--modules")
a = ap.parse_args()
try:
    prof, ctx = load_profile(a.profile), load_context(a.context)
    run = resolve(prof, ctx, a.mode, a.discovery, a.modules)
except ConfigError as e:
    print(f"CONFIG ERROR: {e}"); sys.exit(2)
print(f"profile={prof['name']} context={ctx['name']} target={ctx['target']}")
print(f"mode={run['mode']} discovery={run['discovery']} modules={run['modules']} grep={run['grep']}")
