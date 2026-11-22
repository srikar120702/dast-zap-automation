# DAST automation with OWASP ZAP + Playwright

Automated Dynamic Application Security Testing (DAST) that drives the **OWASP ZAP**
daemon through its REST API. A **Playwright e2e suite** is used as the discovery engine:
the browser is proxied through ZAP, so every page, form and API call that the tests
exercise (including login) becomes part of one scan. Target: **OWASP Juice Shop** in Docker.

- **Passive** or **active** scan for the whole run
- **Profile** = *how* to scan (mode, modules, scan policy, report formats, CI gate)
- **Context** = *what* to scan and *as whom* (target, scope, auth, module → test tag map)
- **Module selection**: run 1, 2 or all test modules (`@account @catalog @basket @feedback`)
- Reports (HTML + JSON + summary) and a CI **exit-code gate**

> Spider/AJAX-spider discovery is designed but deferred; `discovery: playwright` is the implemented path.

## Architecture

```
            dast_scan.py ── REST API (apikey) ──┐
            │  1 new session + context           │
            │  2 passive gate closed             ▼
            │  3 gate open, run e2e tests   ┌──────────┐      ┌─────────────┐
 Playwright ─── HTTP proxy localhost:8080 ─►│ ZAP 2.17 │─────►│ Juice Shop  │
 (Chromium)                                 │ (Docker) │◄─────│ :3000       │
            │  4 drain passive queue        └──────────┘      └─────────────┘
            │  5 [active] attack recorded site tree with scan policy
            └  6 reports + dedupe + gate  →  exit 0 / 1
```

The browser uses `baseURL=http://juice-shop:3000`, a hostname only ZAP can resolve inside
the Docker network, so traffic **cannot** bypass the proxy.

## Repository layout

```
docker-compose.yml        ZAP daemon + Juice Shop on a shared network
dast_scan.py              Orchestrator (CLI entry point)
dast/config.py            Profile/context loading, validation, CLI overrides
profiles/quick.yaml       Passive, catalog+basket, fail on High  (per-PR)
profiles/full.yaml        Active, all modules, fail on Medium    (nightly)
contexts/juiceshop.yaml   Target, scope, active-scan excludes, auth, modules
scripts/register_user.py  Creates the scan user (Juice Shop data is in-memory)
scripts/check_config.py   Dry-run: validate profile+context, print effective run
e2e/                      Playwright suite (tagged by module) + exploration scripts
reports/                  Output (git-ignored; mounted into the ZAP container)
```

## Prerequisites

Docker Desktop, Python 3.10+, Node 20+.

```powershell
git clone <this repo>; cd dast-zap-automation
copy .env.example .env            # then set a random ZAP_API_KEY and JS_PASS
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
cd e2e; npm ci; npx playwright install chromium; cd ..
docker compose up -d
.\.venv\Scripts\python.exe scripts\register_user.py   # re-run after every Juice Shop restart
```

## Running a scan

```powershell
# quick profile: passive, catalog + basket modules
.\.venv\Scripts\python.exe dast_scan.py --profile profiles\quick.yaml --context contexts\juiceshop.yaml
echo $LASTEXITCODE

# override mode / modules from the CLI
.\.venv\Scripts\python.exe dast_scan.py --profile profiles\quick.yaml --context contexts\juiceshop.yaml --modules all
.\.venv\Scripts\python.exe dast_scan.py --profile profiles\quick.yaml --context contexts\juiceshop.yaml --mode active --modules catalog

# nightly: active, all modules
.\.venv\Scripts\python.exe dast_scan.py --profile profiles\full.yaml --context contexts\juiceshop.yaml

# validate config only (no ZAP calls)
.\.venv\Scripts\python.exe scripts\check_config.py --profile profiles\quick.yaml --context contexts\juiceshop.yaml --modules account,feedback
```

| Exit code | Meaning |
|---|---|
| 0 | Scan finished, gate passed |
| 1 | Gate failed: a finding at or above `reporting.fail_on` |
| 2 | Config error (bad profile/context, missing env var, unknown module) |
| 3 | Runtime error (ZAP unreachable, no traffic recorded, scan failed) |

Run the e2e suite alone (through ZAP):

```powershell
cd e2e
node node_modules/@playwright/test/cli.js test --grep "@catalog|@basket"
```

> Use `node .../cli.js`, not `npx`, on Windows: `npx.cmd` goes through `cmd.exe`, which
> treats the `|` in the grep pattern as a pipe and silently runs zero tests.

## How a scan works

1. **Fresh session**: `core.newSession`, so results contain only this run.
2. **Context and scope**: include/exclude regexes from the context, context marked in-scope,
   passive scanning restricted to scope.
3. **Gate**: `pscan.disableAllScanners` until the selected tests start, then enable. The whole
   e2e run, login included, is the scan window.
4. **Discovery**: Playwright runs with `--grep` built from the selected modules' tags; ZAP
   records every request/response.
5. **Passive scan**: wait for `pscan.recordsToScan == 0`.
6. **Active scan** (mode=active): creates a scan policy (attack strength + alert threshold),
   excludes dangerous endpoints (`active_exclude`, such as change-password), injects a fresh
   JWT for the scan user via a Replacer rule that only applies to the active scanner, then
   attacks the recorded site tree.
7. **Report and gate**: ZAP HTML/JSON reports, alerts deduped by (plugin, URL, param), filtered
   by `min_confidence`, gate on `fail_on`, `*-summary.json` written.

## Profiles vs contexts

```yaml
# profiles/quick.yaml (HOW)
mode: passive
discovery: playwright
playwright: { project_dir: ./e2e, modules: [catalog, basket] }
active: { attack_strength: LOW, alert_threshold: MEDIUM, max_duration_minutes: 10 }
reporting: { formats: [html, json], fail_on: high, min_confidence: medium }
```

```yaml
# contexts/juiceshop.yaml (WHAT / AS WHOM)
target: http://juice-shop:3000
scope: { include: [...], exclude: [socket.io, logout, static assets], active_exclude: [...] }
auth: { login_url: http://localhost:3000/rest/user/login, username_env: JS_USER, password_env: JS_PASS }
modules: { account: "@account", catalog: "@catalog", basket: "@basket", feedback: "@feedback" }
```

Credentials are referenced by env-var name only; values live in the git-ignored `.env`.

## E2E suite

| Module | Tag | Tests |
|---|---|---|
| account | `@account` | UI registration, login, wrong password, change password |
| catalog | `@catalog` | browse, search, product dialog + reviews, product API |
| basket | `@basket` | add to basket, quantity via API, full checkout (address, delivery, card, order) |
| feedback | `@feedback` | contact form + captcha, complaint, product review, feedback API |
| smoke | `@smoke` | home page loads through ZAP |

## Sample result (quick profile)

7/7 tests passed, 205 requests / 75 URLs recorded, 50 raw alerts → 41 findings
(1 High, 35 Medium, 2 Low, 3 Info). Gate **failed** on a real issue:
**PII Disclosure**, where `POST /api/Cards/` echoes the full card number. Only the checkout
test reaches this endpoint, which is why test-driven discovery finds what crawlers miss.

## Safety

Active scanning sends attack payloads. Run it only against systems you are authorised to
test (here, a local Juice Shop container).
