from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from . import posted, tiers
from . import state as state_mod
from .config import Company, Filters, GitHubList, term_matches
from .fetchers import amazon, apple, ashby, eightfold, google, greenhouse, ibm, lever, meta, oracle, simplify, smartrecruiters, workday
from .models import FetchError, Job
from .notify import Notifier

ET = ZoneInfo("America/New_York")
DAILY_PING_HOUR_ET = 9
MAX_INDIVIDUAL_ALERTS = 15  # beyond this, roll the rest into one summary (ntfy rate limits)
COMPANY_FETCHERS = {"greenhouse": greenhouse.fetch, "lever": lever.fetch, "ashby": ashby.fetch,
                    "workday": workday.fetch, "smartrecruiters": smartrecruiters.fetch,
                    "amazon": amazon.fetch, "eightfold": eightfold.fetch, "google": google.fetch, "apple": apple.fetch,
                    "meta": meta.fetch, "oracle": oracle.fetch, "ibm": ibm.fetch}


@dataclass(frozen=True)
class Source:
    key: str
    label: str
    tier: str
    check_include: bool
    target: Company | GitHubList
    terms: tuple[str, ...] = ()

    def matches(self, job: Job, filters: Filters) -> bool:
        # A list's Terms column ("Winter 2027") counts as part of the title, so
        # term-based title rules work for rows like "Middleware Software Intern".
        text = f"{job.title} ({job.term})" if job.term else job.title
        software_only = isinstance(self.target, Company) and self.target.software_only
        if filters.excluded_company(job.company):
            return False
        return (filters.matches(text, check_include=self.check_include, software_only=software_only)
                and term_matches(job.term, self.terms)
                and filters.location.allows(filters.placement(job.location_texts)))


@dataclass(frozen=True)
class Candidate:
    job: Job
    source_key: str
    tier: str
    preferred: bool = False  # in a preferred city/state (filters.yaml location.preferred)


def _priority(tier: str, preferred: bool) -> str:
    return "high" if tier == tiers.REACH or preferred else "default"


def build_sources(companies: list[Company], lists: list[GitHubList]) -> list[Source]:
    sources = [Source(c.key, c.name, c.tier, True, c) for c in companies]
    sources += [Source(g.key, g.name, g.tier, g.apply_include, g, tuple(g.terms)) for g in lists]
    return sources


def default_fetch(source: Source, session, prev_sha: str | None):
    """Returns (jobs or None if unchanged, sha or None)."""
    target = source.target
    if isinstance(target, GitHubList):
        return simplify.fetch(target, session, prev_sha)
    return COMPANY_FETCHERS[target.ats](target, session), None


def _norm(s: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())


def fingerprint(job: Job) -> str:
    """Same posting seen via two sources (e.g. Greenhouse + Simplify) alerts once."""
    return f"{_norm(job.company)}|{_norm(job.title)}"


def alert_body(j: Job, now: datetime) -> str:
    where = j.location or "Location not listed"
    if j.term:
        where = f"{j.term} · {where}"
    return f"{where}\n{posted.posted_line(j, now)}"


def run(*, sources: list[Source], filters: Filters, state: dict, notifier: Notifier,
        session=None, now: datetime | None = None, fetch=default_fetch, log=print) -> dict:
    now = now or datetime.now(tz=ET)
    now_et = now.astimezone(ET)
    today = now_et.date().isoformat()
    first_run = not state["sources"]
    tier_by_company = {_norm(s.label): s.tier for s in sources if isinstance(s.target, Company)}

    # ---- fetch everything in parallel ----
    def _one(src: Source):
        prev_sha = state["sources"].get(src.key, {}).get("sha")
        try:
            return src, fetch(src, session, prev_sha), None
        except FetchError as exc:
            return src, None, str(exc)
        except Exception as exc:  # parser bug etc. — still report, never crash the run
            return src, None, f"{type(exc).__name__}: {exc}"

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_one, sources))

    # ---- fetch errors: alert once when a source starts failing ----
    errors = {src.key: (src, err) for src, _, err in results if err}
    newly_failing = [(s, e) for k, (s, e) in errors.items() if k not in state["failing"]]
    recovered = [k for k in state["failing"] if k not in errors]
    for k in recovered:
        log(f"recovered: {k}")
        del state["failing"][k]
    for src, err in newly_failing:
        log(f"FAILING: {src.label} ({src.key}): {err}")
    if newly_failing:
        names = ", ".join(s.label for s, _ in newly_failing)
        body = "\n".join(f"{s.label} [{s.key}]: {e}" for s, e in newly_failing)
        try:
            notifier.send(f"job-radar: fetch failed — {names}", body, priority="low", tags=["warning"])
            for src, err in newly_failing:
                state["failing"][src.key] = {"since": now.isoformat(timespec="seconds"), "error": err}
        except Exception as exc:
            log(f"could not send error alert: {exc}")
    for k, (_, err) in errors.items():
        if k in state["failing"]:
            state["failing"][k]["error"] = err

    # ---- diff against seen ----
    candidates: list[Candidate] = []
    current_ids: dict[str, set[str]] = {}
    seeded = []
    for src, fetched, err in results:
        if err:
            continue
        jobs, sha = fetched
        if jobs is None:  # unchanged README
            continue
        entry = state["sources"].get(src.key)
        current_ids[src.key] = {j.id for j in jobs}
        if entry is None:
            # first time we see this source: everything is "already seen"
            state["sources"][src.key] = {"seen": {j.id: today for j in jobs}, **({"sha": sha} if sha else {})}
            seeded.append(f"{src.label} ({len(jobs)})")
            continue
        if sha:
            entry["sha"] = sha
        seen = entry["seen"]
        for job in jobs:
            if job.id in seen:
                continue
            if src.matches(job, filters):
                tier = tiers.posting_tier(tier_by_company.get(_norm(job.company), src.tier), job.location_texts)
                preferred = filters.placement(job.location_texts).preferred
                candidates.append(Candidate(job, src.key, tier, preferred))
            else:
                seen[job.id] = today
    if seeded:
        log(("first run — " if first_run else "new sources — ") + "seeded silently: " + ", ".join(seeded))

    # ---- de-dupe across sources / previous alerts ----
    to_alert: list[Candidate] = []
    fps_this_run: set[str] = set()
    for c in sorted(candidates, key=lambda c: (not c.preferred, tiers.RANK.get(c.tier, 9), c.job.company, c.job.title)):
        fp = fingerprint(c.job)
        if fp in state["alerted"] or fp in fps_this_run:
            state["sources"][c.source_key]["seen"][c.job.id] = today
            continue
        fps_this_run.add(fp)
        to_alert.append(c)

    # ---- notify; mark seen only after a successful send so failures retry ----
    sent, notify_failures = 0, 0

    def _mark(c: Candidate):
        state["sources"][c.source_key]["seen"][c.job.id] = today
        state["alerted"][fingerprint(c.job)] = today

    lookup_cache: dict = {}
    for c in to_alert[:MAX_INDIVIDUAL_ALERTS]:
        j = posted.resolve(c.job, session, lookup_cache, log=log)
        body = alert_body(j, now)
        try:
            notifier.send(
                f"{j.company} — {j.title}",
                body,
                click=j.url or None,
                priority=_priority(c.tier, c.preferred),
                tags=["star"] if c.preferred else None,
            )
            _mark(c)
            sent += 1
            log(f"alert [{c.tier}] {j.company} — {j.title} | {body!r} | {j.url}")
        except Exception as exc:
            notify_failures += 1
            log(f"notify failed for {j.company} — {j.title}: {exc}")

    overflow = to_alert[MAX_INDIVIDUAL_ALERTS:]
    if overflow:
        lines = [f"{'⭐ ' if c.preferred else ''}{c.job.company} — {c.job.title} ({c.job.location})"
                 for c in overflow]
        try:
            notifier.send(f"job-radar: +{len(overflow)} more new postings", "\n".join(lines)[:3800],
                          priority="default", tags=["inbox_tray"])
            for c in overflow:
                _mark(c)
            sent += len(overflow)
        except Exception as exc:
            notify_failures += 1
            log(f"overflow summary failed: {exc}")

    # ---- daily heartbeat ----
    daily = state["daily"]
    daily["count"] = daily.get("count", 0) + sent
    if first_run:
        daily["last_ping_date"] = today if now_et.hour >= DAILY_PING_HOUR_ET else daily.get("last_ping_date")
        daily["count"] = 0
    elif now_et.hour >= DAILY_PING_HOUR_ET and daily.get("last_ping_date") != today:
        n = daily["count"]
        body = f"Watching {len(sources)} sources."
        if state["failing"]:
            body += " Failing: " + ", ".join(sorted(state["failing"]))
        try:
            notifier.send(f"radar alive: {n} new today", body, priority="low", tags=["satellite"])
            daily["last_ping_date"] = today
            daily["count"] = 0
        except Exception as exc:
            notify_failures += 1
            log(f"daily ping failed: {exc}")

    state_mod.prune(state, current_ids, now_et.date())
    summary = {
        "first_run": first_run,
        "sources": len(sources),
        "errors": len(errors),
        "candidates": len(candidates),
        "alerted": sent,
        "notify_failures": notify_failures,
    }
    log(f"done: {summary}")
    return summary


SIMPLIFY_FRESH_AGES = {"0d", "1d"}  # only these Simplify rows are worth a time lookup


def recent(*, sources: list[Source], filters: Filters, notifier: Notifier, n: int,
           session=None, now: datetime | None = None, fetch=default_fetch, log=print) -> list[Job]:
    """One-off: send the n most recently *posted* matching jobs. Does not touch state.

    Only postings with a known publish time can be ranked; Simplify rows whose
    link isn't Greenhouse/Lever/Ashby have no exact time and are skipped."""
    now = now or datetime.now(tz=ET)
    tier_by_company = {_norm(s.label): s.tier for s in sources if isinstance(s.target, Company)}
    pool: list[tuple[Job, str]] = []
    cache: dict = {}
    for src in sources:
        try:
            jobs, _ = fetch(src, session, None)
        except Exception as exc:
            log(f"skipping {src.label}: {exc}")
            continue
        for j in jobs or []:
            if not src.matches(j, filters):
                continue
            if not j.posted_at and (j.age or "").strip() in SIMPLIFY_FRESH_AGES:
                j = posted.resolve(j, session, cache, log=log)
            if j.posted_at and posted._parse(j.posted_at):
                pool.append((j, tiers.posting_tier(tier_by_company.get(_norm(j.company), src.tier), j.location_texts)))

    pool.sort(key=lambda p: posted._parse(p[0].posted_at), reverse=True)
    picked, fps = [], set()
    for j, tier in pool:
        fp = fingerprint(j)
        if fp not in fps:
            fps.add(fp)
            picked.append((j, tier))
        if len(picked) == n:
            break

    # send oldest first so the newest ends up on top of the notification list
    for j, tier in reversed(picked):
        body = alert_body(j, now)
        notifier.send(f"{j.company} — {j.title}", body, click=j.url or None, priority="default")
    return [j for j, _ in picked]
