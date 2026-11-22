"""Load + validate profile (how) and context (what/as whom) YAML files."""
from __future__ import annotations
import os
from pathlib import Path
import yaml

MODES = {"passive", "active"}
DISCOVERY = {"spider", "playwright"}
STRENGTHS = {"LOW", "MEDIUM", "HIGH", "INSANE"}
THRESHOLDS = {"LOW", "MEDIUM", "HIGH"}
RISKS = ["informational", "low", "medium", "high"]
CONFIDENCES = ["low", "medium", "high"]


class ConfigError(ValueError):
    pass


def _load(path: str) -> dict:
    p = Path(path)
    if not p.is_file():
        raise ConfigError(f"file not found: {path}")
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ConfigError(f"{path}: top level must be a mapping")
    return data


def _need(d: dict, key: str, where: str):
    if key not in d or d[key] in (None, ""):
        raise ConfigError(f"{where}: missing '{key}'")
    return d[key]


def _one_of(value, allowed, where):
    if value not in allowed:
        raise ConfigError(f"{where}: '{value}' not in {sorted(allowed)}")


def load_context(path: str) -> dict:
    c = _load(path)
    _need(c, "name", path)
    target = _need(c, "target", path)
    if not str(target).startswith(("http://", "https://")):
        raise ConfigError(f"{path}: target must be an http(s) URL")
    scope = c.setdefault("scope", {})
    scope.setdefault("include", [f"{target}.*"])
    scope.setdefault("exclude", [])
    mods = c.setdefault("modules", {})
    if not isinstance(mods, dict):
        raise ConfigError(f"{path}: modules must map name -> @tag")
    auth = c.get("auth")
    if auth:
        for k in ("login_url", "username_env", "password_env"):
            _need(auth, k, f"{path}: auth")
        for k in ("username_env", "password_env"):
            if not os.environ.get(auth[k]):
                raise ConfigError(f"env var {auth[k]} not set (see .env)")
        auth.setdefault("token_json_path", "authentication.token")
        auth.setdefault("header", "Authorization")
        auth.setdefault("header_prefix", "Bearer ")
    return c


def load_profile(path: str) -> dict:
    p = _load(path)
    _need(p, "name", path)
    _one_of(p.setdefault("mode", "passive"), MODES, f"{path}: mode")
    _one_of(p.setdefault("discovery", "spider"), DISCOVERY, f"{path}: discovery")
    p.setdefault("playwright", {}).setdefault("project_dir", "./e2e")
    p["playwright"].setdefault("modules", "all")
    p["playwright"].setdefault("timeout_minutes", 15)
    p.setdefault("spider", {}).setdefault("max_duration_minutes", 2)
    p["spider"].setdefault("max_depth", 5)
    p["spider"].setdefault("ajax", False)
    p["spider"].setdefault("ajax_max_duration_minutes", 2)
    p.setdefault("passive", {}).setdefault("wait_timeout_minutes", 5)
    a = p.setdefault("active", {})
    a.setdefault("policy", f"{p['name']}-policy")
    _one_of(a.setdefault("attack_strength", "MEDIUM"), STRENGTHS, f"{path}: active.attack_strength")
    _one_of(a.setdefault("alert_threshold", "MEDIUM"), THRESHOLDS, f"{path}: active.alert_threshold")
    a.setdefault("max_duration_minutes", 15)
    r = p.setdefault("reporting", {})
    r.setdefault("out_dir", "./reports")
    r.setdefault("formats", ["html", "json"])
    _one_of(r.setdefault("fail_on", "high"), set(RISKS), f"{path}: reporting.fail_on")
    _one_of(r.setdefault("min_confidence", "medium"), set(CONFIDENCES), f"{path}: reporting.min_confidence")
    return p


def resolve(profile: dict, context: dict, mode=None, discovery=None, modules=None) -> dict:
    """Apply CLI overrides and return the effective run settings."""
    mode = mode or profile["mode"]
    discovery = discovery or profile["discovery"]
    _one_of(mode, MODES, "--mode")
    _one_of(discovery, DISCOVERY, "--discovery")

    selected = modules if modules is not None else profile["playwright"]["modules"]
    if isinstance(selected, str):
        selected = list(context["modules"]) if selected == "all" else [m.strip() for m in selected.split(",") if m.strip()]
    unknown = [m for m in selected if m not in context["modules"]]
    if unknown:
        raise ConfigError(f"unknown modules {unknown}; context has {list(context['modules'])}")
    if discovery == "playwright" and not selected:
        raise ConfigError("playwright discovery needs at least one module")

    grep = "|".join(context["modules"][m] for m in selected)
    return {"mode": mode, "discovery": discovery, "modules": selected, "grep": grep}
