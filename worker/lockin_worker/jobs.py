from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from job_radar import posted
from job_radar import state as state_mod
from job_radar.config import Filters, GitHubList, load_companies, load_filters, load_lists
from job_radar.notify import safe_click_url
from job_radar.radar import Source, _norm, build_sources, default_fetch, fingerprint

from . import clock

STATE_KEY = "jobs"
MAX_RESOLVE = 30  # posted-time lookups per run (each one is an HTTP call)


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


def collect(db, sources: list[Source], filters: Filters, session, now: datetime, fetch=default_fetch) -> dict:
    st = _load_state(db)
    today = clock.local_day(now).isoformat()
    tier_by_company = {_norm(s.label): s.tier for s in sources if not isinstance(s.target, GitHubList)}

    def one(src):
        try:
            return src, fetch(src, session, st["sources"].get(src.key, {}).get("sha")), None
        except Exception as exc:  # FetchError or a parser bug: report it and keep going
            return src, None, str(exc)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, sources))

    errors = {src.key: err for src, _, err in results if err}
    current_ids: dict[str, set[str]] = {}
    known: set[str] = set()  # in-run dedupe; the DB write ignores existing ids
    to_insert, seeded, cache = [], 0, {}
    for src, fetched, err in results:
        if err or fetched[0] is None:
            continue
        found, sha = fetched
        current_ids[src.key] = {j.id for j in found}
        entry = st["sources"].get(src.key)
        if entry is None:
            st["sources"][src.key] = {"seen": {j.id: today for j in found}, **({"sha": sha} if sha else {})}
            seeded += 1
            continue
        if sha:
            entry["sha"] = sha
        for job in found:
            if job.id in entry["seen"]:
                continue
            entry["seen"][job.id] = today
            if not src.matches(job, filters):
                continue
            fp = fingerprint(job)
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
    return {"new": len(to_insert), "seeded": seeded, "errors": errors}
