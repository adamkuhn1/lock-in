from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

from job_radar import posted
from job_radar import state as state_mod
from job_radar.config import Filters, GitHubList, load_companies, load_filters, load_lists
from job_radar.notify import safe_click_url
from job_radar.radar import Source, _norm, build_sources, default_fetch

from . import clock

STATE_KEY = "jobs"
MAX_RESOLVE = 30  # posted-time lookups per run (each one is an HTTP call)
SEED_DAYS = 90  # a newly added company brings its matching postings from this far back (season programs stay open for months)
UNDATED_ATS = {"meta"}  # sites that never give a posting date
FAIL_ALERT_AFTER = 6  # consecutive failed runs (~3 hours at every 30 min) before a board is reported


def load_sources(config_dir: Path) -> tuple[list[Source], Filters]:
    companies = load_companies(config_dir / "companies.yaml")
    lists = load_lists(config_dir / "lists.yaml")
    return build_sources(companies, lists), load_filters(config_dir / "filters.yaml")


def _load_state(db) -> dict:
    rows = db.select("worker_state", {"key": STATE_KEY})
    st = state_mod.empty()
    if rows:
        st.update(rows[0]["value"])
    return st


def posting_id(job) -> str:
    """The postings row id: company, title and location, so the NYC and SF openings of one role are two cards."""
    return f"{_norm(job.company)}|{_norm(job.title)}|{_norm(job.location or '')}"


def _recent(posted_at: str | None, now: datetime) -> bool:
    try:
        when = datetime.fromisoformat((posted_at or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    if when.tzinfo is None:
        when = when.replace(tzinfo=now.tzinfo)
    return now - when <= timedelta(days=SEED_DAYS)


def collect(db, sources: list[Source], filters: Filters, session, now: datetime, fetch=default_fetch) -> dict:
    st = _load_state(db)
    today = clock.local_day(now).isoformat()
    tier_by_company = {_norm(s.label): s.tier for s in sources if not isinstance(s.target, GitHubList)}
    direct = set(tier_by_company)  # companies with their own board: their GitHub-list rows would only be duplicates

    def one(src):
        try:
            return src, fetch(src, session, st["sources"].get(src.key, {}).get("sha")), None
        except Exception as exc:  # FetchError or a parser bug: report it and keep going
            return src, None, str(exc)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, sources))

    errors = {src.key: err for src, _, err in results if err}
    alert = _track_failures(st, sources, errors, now)
    current_ids: dict[str, set[str]] = {}
    known: set[str] = set()  # in-run dedupe; the DB write ignores existing ids
    to_insert, seeded, cache = [], 0, {}
    for src, fetched, err in results:
        if err or fetched[0] is None:
            continue
        found, sha = fetched
        current_ids[src.key] = {j.id for j in found}
        entry = st["sources"].get(src.key)
        fresh_only = entry is None
        undated = getattr(src.target, "ats", None) in UNDATED_ATS  # no posting dates at all: bring every match
        if entry is None:
            # First run for this source: everything counts as seen, but its recent matches still reach the inbox,
            # so adding a company shows what it has open now. Lists (Simplify) stay silent: they're mostly old rows.
            entry = st["sources"][src.key] = {"seen": {}, **({"sha": sha} if sha else {})}
            seeded += 1
            if isinstance(src.target, GitHubList):
                entry["seen"] = {j.id: today for j in found}
                continue
        if sha:
            entry["sha"] = sha
        for job in found:
            if job.id in entry["seen"]:
                continue
            entry["seen"][job.id] = today
            if fresh_only and not _recent(job.posted_at, now) and not undated:
                continue
            if not src.matches(job, filters):
                continue
            if isinstance(src.target, GitHubList) and _norm(job.company) in direct:
                continue
            fp = posting_id(job)
            if fp in known:
                continue
            known.add(fp)
            if len(to_insert) < MAX_RESOLVE:
                job = posted.resolve(job, session, cache, log=lambda *_: None)
            to_insert.append({
                "id": fp, "company": job.company, "title": job.title, "location": job.location or None,
                "url": safe_click_url(job.url), "term": job.term, "posted_at": job.posted_at,
                "tier": tier_by_company.get(_norm(job.company), src.tier),
                "starred": filters.placement(job.location_texts).preferred,
                "status": "new", "found_at": now.isoformat(),
            })
    if to_insert:
        db.upsert("postings", to_insert, on_conflict="id", ignore_duplicates=True)
    state_mod.prune(st, current_ids, clock.local_day(now))
    db.upsert("worker_state", [{"key": STATE_KEY, "value": st}], on_conflict="key")
    return {"new": len(to_insert), "seeded": seeded, "errors": errors, "alert": alert}


def _track_failures(st: dict, sources: list[Source], errors: dict[str, str], now: datetime) -> list[str]:
    """Count consecutive failures per board; return "Name: error" for boards that just reached FAIL_ALERT_AFTER.

    Each board is reported once per outage: it alerts again only after it recovers and breaks again."""
    failing = st.setdefault("failing", {})
    for key in [k for k in failing if k not in errors]:
        del failing[key]
    label = {s.key: s.label for s in sources}
    out = []
    for key, err in errors.items():
        f = failing.setdefault(key, {"since": now.isoformat(timespec="seconds"), "count": 0})
        f["count"] = int(f.get("count") or 0) + 1
        f["error"] = err[:200]
        if f["count"] >= FAIL_ALERT_AFTER and not f.get("alerted"):
            f["alerted"] = True
            out.append(f"{label.get(key, key)}: {err[:120]}")
    return sorted(out)
