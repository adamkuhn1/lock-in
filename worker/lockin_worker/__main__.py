from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import requests

from . import clock, jobs, learn, leetcode, nudges, plan, projects, sheet
from .bank import load_bank, load_topics
from .db import RestDB

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


def _safe_err(exc: Exception) -> str:
    msg = re.sub(r"\?[^\s'\"]*", "?…", str(exc))[:200]
    return f"{type(exc).__name__}: {msg}"


def _status(db, source: str, now: datetime, err: str | None) -> None:
    prev = (db.select("sync_status", {"source": source}) or [{}])[0]
    if err is None:
        row = {"source": source, "last_ok_at": now.isoformat(), "last_error": None,
               "consecutive_failures": 0, "failing_since": None}
    else:
        row = {"source": source, "last_error": err[:500],
               "consecutive_failures": int(prev.get("consecutive_failures") or 0) + 1,
               "failing_since": prev.get("failing_since") or now.isoformat()}
    db.upsert("sync_status", [row], on_conflict="source")


def _counts(out) -> dict:
    """Loggable step summary: counts only (errors reduced to their source keys) so Actions logs never carry error text."""
    if not isinstance(out, dict):
        return {}
    res = {}
    for k, v in out.items():
        if k == "errors" and isinstance(v, dict):
            res[k] = sorted(v)
        elif isinstance(v, int):
            res[k] = v
    return res


def default_steps(env: dict):
    def _settings(db):
        return (db.select("settings") or [{}])[0]

    def lc(db, session, now):
        return leetcode.sync(db, session, _settings(db).get("lc_username") or "adamkuhn", now)

    def gh(db, session, now):
        return projects.sync(db, session, env.get("LOCKIN_GH_TOKEN") or env.get("GITHUB_TOKEN"), now)

    def sh(db, session, now):
        sid = _settings(db).get("sheet_id") or env.get("SHEET_ID")
        if not sid or not env.get("GOOGLE_SA_JSON"):
            return {"skipped": "not configured"}
        srcs, _ = jobs.load_sources(CONFIG_DIR)
        return sheet.sync(db, session, sid, json.loads(env["GOOGLE_SA_JSON"]), index=jobs.tier_index(srcs))

    def jb(db, session, now):
        srcs, filters = jobs.load_sources(CONFIG_DIR)
        out = jobs.collect(db, srcs, filters, session, now)
        out["tiered"] = jobs.tier_untiered(db, jobs.tier_index(srcs))
        if out["errors"]:
            # one board failing isn't a "jobs" failure; log only the source keys, and fail only if every source failed
            print("job sources failing:", sorted(out["errors"]))
            if len(out["errors"]) == len(srcs):
                raise RuntimeError("all job sources failed")
        settings = _settings(db)
        topic = settings.get("ntfy_topic") or env.get("NTFY_TOPIC")
        if settings.get("job_alerts") and topic and out.get("fresh"):
            # New reach and Midwest postings one push each; volume ones in one summary. Best effort.
            for title, body, priority, click in jobs.alerts(out["fresh"], settings.get("app_url")):
                try:
                    nudges.send(session, topic, nudges.Nudge("job", title, body, priority, click))
                except Exception as exc:
                    print(f"FAILED job alert: {_safe_err(exc)}", file=sys.stderr)
                    break
        if out.get("alert") and topic:
            try:
                nudges.send(session, topic, nudges.Nudge(
                    "jobs_failing", f"Job boards failing ({len(out['alert'])})",
                    "\n".join(out["alert"]) + "\n\nFix the token in worker/config/companies.yaml, or remove the company.",
                    "low"))
            except Exception as exc:  # the alert is best effort; the postings are already saved
                print(f"FAILED job board alert: {_safe_err(exc)}", file=sys.stderr)
        return out

    return [("leetcode", lc), ("github", gh), ("sheet", sh), ("jobs", jb)]


def run(db, session, now: datetime, env: dict, steps=None) -> dict:
    rows = db.select("settings")  # fail fast (and loudly) if Supabase is down
    if not rows:
        raise RuntimeError("settings row missing — run `python -m lockin_worker.seed`")
    ok, failed = [], {}
    for name, fn in steps if steps is not None else default_steps(env):
        try:
            print(name, _counts(fn(db, session, now)))
            _status(db, name, now, None)
            ok.append(name)
        except Exception as exc:
            msg = _safe_err(exc)
            print(f"FAILED {name}: {msg}", file=sys.stderr)
            _status(db, name, now, msg)
            failed[name] = msg
    return {"ok": ok, "failed": failed}


def _record(db, source: str, now: datetime, err: str | None) -> None:
    try:
        _status(db, source, now, err)
    except Exception as exc:  # a status write must never stop the next phase
        print(f"FAILED recording {source} status: {_safe_err(exc)}", file=sys.stderr)


def finish(db, session, now: datetime, env: dict) -> list[str]:
    """Post-sync phases, each isolated; nudges always attempted. Returns the failed sync_status sources."""
    failed: list[str] = []
    errors: list[str] = []
    try:
        bank, topics = load_bank(), load_topics()
        today = clock.plan_day(now)
        phases = [
            ("apply_pending", lambda: leetcode.apply_pending(db, bank, today, now)),
            ("recompute_levels", lambda: leetcode.recompute_levels(db, bank, topics, today)),
            ("ensure_plan", lambda: plan.ensure_plan(db, now, bank, topics)),
            ("refresh_done", lambda: plan.refresh_done(db, now)),
            ("complete_idea_on_commit", lambda: projects.complete_idea_on_commit(db, today, now)),
            ("complete_started_ideas", lambda: projects.complete_started_ideas(db)),
            ("learn_content", lambda: learn.sync_content(db)),
        ]
    except Exception as exc:
        errors.append(f"load: {_safe_err(exc)}")
        phases = []
    for name, fn in phases:
        try:
            fn()
        except Exception as exc:
            errors.append(f"{name}: {_safe_err(exc)}")
            print(f"FAILED plan.{name}: {errors[-1]}", file=sys.stderr)
    if errors:
        failed.append("plan")
    _record(db, "plan", now, "; ".join(errors) if errors else None)

    try:
        s = (db.select("settings") or [{}])[0]
        topic = s.get("ntfy_topic") or env.get("NTFY_TOPIC")
        if topic:
            times = s.get("nudge_times") or ["10:00", "18:00", "22:00"]
            print("nudges", nudges.run(db, session, now, topic, s.get("app_url"), times))
            _record(db, "nudges", now, None)
    except Exception as exc:
        msg = _safe_err(exc)
        print(f"FAILED nudges: {msg}", file=sys.stderr)
        failed.append("nudges")
        _record(db, "nudges", now, msg)
    return failed


def main(argv: list[str] | None = None) -> int:
    args = argparse.ArgumentParser(prog="lockin_worker")
    args.add_argument("--only", choices=["jobs"], help="run one step and skip the plan and nudges (the 10-minute job scan)")
    opts = args.parse_args(argv or [])
    env = dict(os.environ)
    db = RestDB(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"], env["LOCKIN_OWNER_ID"])
    session = requests.Session()
    session.headers["User-Agent"] = "lock-in-worker/1.0 (+personal)"
    now = clock.now()
    if opts.only:
        summary = run(db, session, now, env, steps=[s for s in default_steps(env) if s[0] == opts.only])
        print("done", summary)
        return 1 if summary["failed"] else 0
    summary = run(db, session, now, env)
    finish_failed = finish(db, session, now, env)
    print("done", summary, "finish failed:", finish_failed)
    return 1 if finish_failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
