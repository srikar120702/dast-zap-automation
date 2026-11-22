"""Register the DAST test user in Juice Shop and verify login.
Juice Shop keeps data in memory, so re-run this after every container restart.
Usage: python scripts/register_user.py   (reads JS_USER / JS_PASS from .env)"""
import json, os, pathlib, urllib.error, urllib.request

env = pathlib.Path(__file__).resolve().parent.parent / ".env"
for line in env.read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); os.environ.setdefault(k, v)

BASE = os.environ.get("JS_BASE", "http://localhost:3000")
USER, PASS = os.environ["JS_USER"], os.environ["JS_PASS"]

def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:200]

s, _ = post("/api/Users", {"email": USER, "password": PASS, "passwordRepeat": PASS,
                           "securityQuestion": {"id": 1}, "securityAnswer": "dast"})
print("register:", s, "(400 = already exists)" if s == 400 else "")
s, b = post("/rest/user/login", {"email": USER, "password": PASS})
ok = s == 200 and b["authentication"].get("token")
print("login:", s, "OK" if ok else "FAILED")
raise SystemExit(0 if ok else 1)
