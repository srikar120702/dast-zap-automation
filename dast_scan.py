"""DAST scan driven by the Playwright e2e suite through the ZAP proxy.

  python dast_scan.py --profile profiles/quick.yaml --context contexts/juiceshop.yaml
  [--mode passive|active] [--modules catalog,basket|all]

Exit codes: 0 gate passed | 1 gate failed | 2 config error | 3 runtime error
"""
from __future__ import annotations
import argparse, json, os, subprocess, sys, time
from collections import Counter
from datetime import datetime
from pathlib import Path

import requests
from zapv2 import ZAPv2

from dast.config import ConfigError, RISKS, CONFIDENCES, load_context, load_profile, resolve

ROOT = Path(__file__).resolve().parent
ZAP_URL = os.environ.get("ZAP_URL", "http://localhost:8080")
ZAP_REPORT_DIR = "/zap/wrk/reports"          # container path, mounted to ./reports
AUTH_RULE = "dast-auth-bearer"


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def wait(label: str, poll, done, timeout_s: float, interval: float = 5) -> bool:
    """Poll until done(value) or timeout. Returns True if finished in time."""
    end = time.time() + timeout_s
    last = None
    while time.time() < end:
        v = poll()
        if v != last:
            log(f"  {label}: {v}")
            last = v
        if done(v):
            return True
        time.sleep(interval)
    log(f"  {label}: timed out after {timeout_s:.0f}s")
    return False


# ---------------------------------------------------------------- ZAP setup
def connect() -> ZAPv2:
    key = os.environ.get("ZAP_API_KEY")
    if not key:
        raise ConfigError("ZAP_API_KEY not set (see .env)")
    zap = ZAPv2(apikey=key, proxies={"http": ZAP_URL, "https": ZAP_URL})
    log(f"ZAP {zap.core.version} at {ZAP_URL}")
    return zap


def prepare_session(zap: ZAPv2, ctx: dict, run_name: str) -> str:
    """Fresh session + one in-scope context. Passive scanning is gated OFF."""
    zap.core.new_session(name=run_name, overwrite=True)
    cid = zap.context.new_context(ctx["name"])
    for rx in ctx["scope"]["include"]:
        zap.context.include_in_context(ctx["name"], rx)
    for rx in ctx["scope"]["exclude"]:
        zap.context.exclude_from_context(ctx["name"], rx)
    zap.context.set_context_in_scope(ctx["name"], "true")
    zap.pscan.set_scan_only_in_scope("true")
    zap.pscan.disable_all_scanners()          # gate: nothing is analysed yet
    log(f"session '{run_name}', context '{ctx['name']}' (id {cid}), passive gate CLOSED")
    return cid


# ----------------------------------------------------------- e2e discovery
def run_playwright(prof: dict, ctx: dict, grep: str) -> int:
    print(f"running Playwright e2e suite with --grep '{grep}'")
    print(prof["playwright"])
    pw = prof["playwright"]
    cwd = (ROOT / pw["project_dir"]).resolve()
    cli = cwd / "node_modules" / "@playwright" / "test" / "cli.js"
    if not cli.exists():
        raise ConfigError(f"Playwright not installed in {cwd} (run npm ci there)")
    env = {**os.environ, "BASE_URL": ctx["target"], "ZAP_PROXY": ZAP_URL}
    # Call node directly: npx.cmd goes through cmd.exe, which treats '|' in grep as a pipe.
    cmd = ["node", str(cli), "test", "--grep", grep, "--reporter=list"]
    log(f"running e2e suite: --grep '{grep}'")
    try:
        return subprocess.run(cmd, cwd=cwd, env=env, timeout=pw["timeout_minutes"] * 60).returncode
    except subprocess.TimeoutExpired:
        log("e2e suite timed out")
        return 124


def get_token(auth: dict) -> str:
    r = requests.post(auth["login_url"], timeout=15, json={
        "email": os.environ[auth["username_env"]],
        "password": os.environ[auth["password_env"]],
    })
    r.raise_for_status()
    data = r.json()
    for part in auth["token_json_path"].split("."):
        data = data[part]
    return data


# ------------------------------------------------------------------ scans
def drain_passive(zap: ZAPv2, prof: dict) -> None:
    wait("passive queue", lambda: int(zap.pscan.records_to_scan), lambda n: n == 0,
         prof["passive"]["wait_timeout_minutes"] * 60, interval=2)


def active_scan(zap: ZAPv2, prof: dict, ctx: dict, cid: str) -> None:
    a = prof["active"]
    if a["policy"] in zap.ascan.scan_policy_names:
        zap.ascan.remove_scan_policy(a["policy"])
    zap.ascan.add_scan_policy(a["policy"], alertthreshold=a["alert_threshold"],
                              attackstrength=a["attack_strength"])
    zap.ascan.set_option_max_scan_duration_in_mins(a["max_duration_minutes"])
    zap.ascan.clear_excluded_from_scan()
    for rx in ctx["scope"].get("active_exclude", []):
        zap.ascan.exclude_from_scan(rx)

    # Attack requests carry a fresh token for the scan user (initiator 2 = active scanner only,
    # so the browser's own requests were never rewritten).
    auth = ctx.get("auth")
    if auth:
        token = get_token(auth)
        zap.replacer.add_rule(AUTH_RULE, "true", "REQ_HEADER", "false", auth["header"],
                              replacement=auth["header_prefix"] + token, initiators="2")
        log("auth header injection ON for active scanner")

    log(f"active scan: policy={a['policy']} strength={a['attack_strength']} "
        f"threshold={a['alert_threshold']} max={a['max_duration_minutes']}m")
    sid = zap.ascan.scan(url=ctx["target"], recurse="true", inscopeonly="true",
                         scanpolicyname=a["policy"], contextid=cid)
    if not str(sid).isdigit():
        raise RuntimeError(f"active scan did not start: {sid}")
    try:
        finished = wait("active scan %", lambda: int(zap.ascan.status(sid)), lambda p: p >= 100,
                        a["max_duration_minutes"] * 60 + 120, interval=10)
        if not finished:
            zap.ascan.stop(sid)
    finally:
        if auth:
            zap.replacer.remove_rule(AUTH_RULE)
    drain_passive(zap, prof)          # attack responses are passively scanned too


# ------------------------------------------------------ report + CI gate
def report_and_gate(zap: ZAPv2, prof: dict, ctx: dict, run: dict, run_name: str, test_rc: int) -> int:
    r = prof["reporting"]
    out = (ROOT / r["out_dir"]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    templates = {"html": "traditional-html", "json": "traditional-json", "md": "traditional-md"}
    for fmt in r["formats"]:
        zap.reports.generate(title=f"DAST {ctx['name']} ({run['mode']})", template=templates[fmt],
                             sites=ctx["target"], reportdir=ZAP_REPORT_DIR,
                             reportfilename=f"{run_name}.{fmt}")
        log(f"report: {out / f'{run_name}.{fmt}'}")

    # Collect alerts (paged), drop false positives / low confidence, dedupe.
    alerts, start = [], 0
    while True:
        page = zap.alert.alerts(baseurl=ctx["target"], start=start, count=500)
        alerts += page
        if len(page) < 500:
            break
        start += 500
    conf_rank = {"low": 0, "medium": 1, "high": 2, "confirmed": 3}
    min_conf = CONFIDENCES.index(r["min_confidence"])
    unique = {}
    for al in alerts:
        c = al["confidence"].lower()
        if c not in conf_rank or conf_rank[c] < min_conf:
            continue
        key = (al["pluginId"], al["url"].split("?")[0], al.get("param", ""))
        unique.setdefault(key, al)
    findings = sorted(unique.values(), key=lambda a: -RISKS.index(a["risk"].lower()))

    by_risk = Counter(a["risk"] for a in findings)
    by_type = Counter((a["risk"], a["alert"]) for a in findings)
    gate_idx = RISKS.index(r["fail_on"])
    blocking = [a for a in findings if RISKS.index(a["risk"].lower()) >= gate_idx]

    summary = {
        "run": run_name, "profile": prof["name"], "context": ctx["name"], "target": ctx["target"],
        "mode": run["mode"], "modules": run["modules"], "e2e_exit_code": test_rc,
        "urls_recorded": len(zap.core.urls(baseurl=ctx["target"])),
        "alerts_raw": len(alerts), "findings": len(findings), "by_risk": dict(by_risk),
        "gate": {"fail_on": r["fail_on"], "min_confidence": r["min_confidence"],
                 "blocking": len(blocking), "passed": not blocking},
        "top": [{"risk": k[0], "alert": k[1], "count": n} for k, n in by_type.most_common(15)],
    }
    (out / f"{run_name}-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n" + "=" * 64)
    print(f" {run_name}   mode={run['mode']}   modules={','.join(run['modules'])}")
    print(f" e2e exit={test_rc}  urls={summary['urls_recorded']}  raw alerts={len(alerts)}  "
          f"findings={len(findings)}")
    for risk in reversed(RISKS):
        print(f"   {risk.capitalize():<14}{by_risk.get(risk.capitalize(), 0)}")
    print(" top findings:")
    for (risk, name), n in by_type.most_common(10):
        print(f"   [{risk:<13}] {name} (x{n})")
    verdict = "PASSED" if not blocking else f"FAILED ({len(blocking)} finding(s) >= {r['fail_on']})"
    print(f" GATE: {verdict}")
    print("=" * 64)
    return 0 if not blocking else 1


# -------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--context", required=True)
    ap.add_argument("--mode", choices=["passive", "active"])
    ap.add_argument("--modules", help="comma list or 'all' (overrides profile)")
    a = ap.parse_args()

    load_env()
    try:
        prof, ctx = load_profile(a.profile), load_context(a.context)
        run = resolve(prof, ctx, a.mode, None, a.modules)
        if run["discovery"] != "playwright":
            raise ConfigError("only discovery=playwright is implemented (spider is deferred)")
        zap = connect()
    except (ConfigError, requests.exceptions.RequestException) as e:
        log(f"CONFIG ERROR: {e}")
        return 2

    run_name = f"{ctx['name']}-{prof['name']}-{run['mode']}-{datetime.now():%Y%m%d-%H%M%S}"
    log(f"run {run_name}: modules={run['modules']}")
    try:
        cid = prepare_session(zap, ctx, run_name)

        # The scan window = the whole selected e2e run, login included.
        zap.pscan.enable_all_scanners()
        log("passive gate OPEN, e2e tests starting")
        test_rc = run_playwright(prof, ctx, run["grep"])
        log(f"e2e finished (exit {test_rc}), {zap.core.number_of_messages(baseurl=ctx['target'])} messages recorded")
        if int(zap.core.number_of_messages(baseurl=ctx["target"])) == 0:
            raise RuntimeError("no traffic reached ZAP; is the browser proxy set?")
        drain_passive(zap, prof)

        if run["mode"] == "active":
            active_scan(zap, prof, ctx, cid)

        return report_and_gate(zap, prof, ctx, run, run_name, test_rc)
    except Exception as e:  # noqa: BLE001 - CLI boundary
        log(f"RUNTIME ERROR: {type(e).__name__}: {e}")
        return 3


if __name__ == "__main__":
    sys.exit(main())
