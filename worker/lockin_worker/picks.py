"""Best fit shortlist: `lockin save-picks` checks Claude's ranked picks and saves them onto postings.

Picks are either a posting already in the inbox ({"id": ...}) or one Claude found on the web
({"company", "title", "url", ...}). New links are fetched once here, so a made-up or closed posting
never reaches the app. Each save replaces the previous shortlist.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

import requests

from job_radar.config import GitHubList
from job_radar.notify import safe_click_url
from job_radar.radar import _norm

from . import jobs

MAX_PICKS = 25
FIELD_MAX = 200
REASON_MAX = 240
OPEN = ("new", "seen")
CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"
# Search results and job aggregators: the link can't be checked and often isn't the real posting.
BLOCKED_HOSTS = ("linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "joinhandshake.com",
                 "monster.com", "simplyhired.com", "google.com", "bing.com", "jobright.ai")
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

LinkCheck = Callable[[str], tuple[str, str]]


class PickError(Exception):
    pass


def check_link(url: str, session=None) -> tuple[str, str]:
    """("ok" | "unverified" | "dead", note). Dead = gone for sure; unverified = the site blocks scripts."""
    s = session or requests
    try:
        r = s.get(url, timeout=15, allow_redirects=True, headers={"User-Agent": USER_AGENT}, stream=True)
        r.close()
    except requests.RequestException as exc:
        return "dead", f"couldn't load it ({type(exc).__name__})"
    final = str(getattr(r, "url", "") or url)
    if r.status_code in (404, 410):
        return "dead", f"HTTP {r.status_code}, the posting is gone"
    if "error=true" in final:  # Greenhouse sends closed postings back to the board with ?error=true
        return "dead", "redirects to the job board, so the posting is closed"
    if r.status_code >= 400:
        return "unverified", f"HTTP {r.status_code} (the site blocks scripts)"
    return "ok", ""


def _host_blocked(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS)


def _text(obj: dict, key: str, where: str, errors: list[str], *, required=False, max_len=FIELD_MAX) -> str | None:
    v = obj.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            errors.append(f"{where}.{key}: required")
        return None
    if not isinstance(v, str):
        errors.append(f"{where}.{key}: must be a string")
        return None
    v = " ".join(v.split())
    if len(v) > max_len:
        errors.append(f"{where}.{key}: longer than {max_len} characters")
    return v


def validate(data: Any) -> list[dict]:
    """The JSON list, best first, cleaned up. Raises PickError listing every problem."""
    if not isinstance(data, list) or not data:
        raise PickError('expected a non-empty JSON list of picks, best first, e.g. [{"id": "...", "reason": "..."}]')
    if len(data) > MAX_PICKS:
        raise PickError(f"at most {MAX_PICKS} picks; got {len(data)}")
    errors: list[str] = []
    out = []
    for i, raw in enumerate(data):
        where = f"$[{i}]"
        if not isinstance(raw, dict):
            errors.append(f"{where}: must be an object")
            continue
        reason = _text(raw, "reason", where, errors, required=True, max_len=REASON_MAX)
        pid = _text(raw, "id", where, errors, max_len=500)
        if pid:
            out.append({"id": pid, "reason": reason})
            continue
        pick = {"reason": reason}
        for key in ("company", "title", "url"):
            pick[key] = _text(raw, key, where, errors, required=True)
        for key in ("location", "term"):
            pick[key] = _text(raw, key, where, errors)
        url = pick.get("url")
        if url:
            if not safe_click_url(url) or len(url) > FIELD_MAX:
                errors.append(f"{where}.url: must be a plain http(s) link")
            elif _host_blocked(url):
                errors.append(f"{where}.url: {urlsplit(url).hostname} is a search or aggregator site; use the company's own posting link")
        out.append(pick)
    if errors:
        raise PickError("\n".join(errors))
    return out


def _lookup(config_dir: Path):
    """Company tier from companies.yaml and the ⭐ preferred-location rule, the same as the job scanner uses."""
    try:
        sources, filters = jobs.load_sources(config_dir)
    except Exception:  # config is optional here: picks still save without a tier or star
        return lambda company: None, lambda location: False
    tiers = {_norm(s.label): s.tier for s in sources if not isinstance(s.target, GitHubList)}
    return (lambda company: tiers.get(_norm(company)),
            lambda location: bool(location) and filters.placement([location]).preferred)


def save(db, picks: list[dict], *, now: datetime, check: LinkCheck = check_link,
         config_dir: Path = CONFIG_DIR) -> dict:
    """Replace the shortlist. Returns {"inbox", "new", "skipped": [notes], "unverified": [notes]}.

    A dead link or unknown id saves nothing and raises PickError, so Claude can fix the list and rerun it."""
    postings = db.select("postings")
    by_id = {p["id"]: p for p in postings}
    by_url = {p["url"]: p for p in postings if p.get("url")}
    applied = {(_norm(a.get("company") or ""), _norm(a.get("role") or "")) for a in db.select("applications")}
    tier_of, starred = _lookup(config_dir)
    errors, skipped, unverified = [], [], []
    kept: list[tuple[dict | None, dict]] = []  # (existing posting or None, pick)
    ids: set[str] = set()
    for i, pick in enumerate(picks, 1):
        if "id" in pick:
            p = by_id.get(pick["id"])
            if p is None:
                errors.append(f"pick {i}: no posting with id {pick['id']!r} (copy ids exactly from inbox.json)")
                continue
        else:
            new_id = jobs.posting_id(_Job(pick))
            p = by_url.get(pick["url"]) or by_id.get(new_id)
            if p is None:
                status, note = check(pick["url"])
                label = f"{pick['company']} · {pick['title']}"
                if status == "dead":
                    errors.append(f"pick {i} ({label}): {pick['url']} {note}")
                    continue
                if status == "unverified":
                    unverified.append(f"{label}: {note}")
        company, title = (p["company"], p["title"]) if p else (pick["company"], pick["title"])
        if p and p.get("status") not in OPEN:
            skipped.append(f"{company} · {title}: already {p.get('status')}")
            continue
        if (_norm(company), _norm(title)) in applied:
            skipped.append(f"{company} · {title}: already in your applications")
            continue
        key = p["id"] if p else new_id
        if key in ids:
            skipped.append(f"{company} · {title}: listed twice")
            continue
        ids.add(key)
        kept.append((p, pick))
    if errors:
        raise PickError("\n".join(errors) + "\nNothing was saved. Drop or fix those picks, then run save-picks again with the full list.")
    if not kept:
        raise PickError("no picks left to save:\n" + "\n".join(skipped))

    for p in postings:  # the new list replaces the old one
        if p.get("fit_rank") is not None and p["id"] not in ids:
            db.update("postings", {"id": p["id"]}, {"fit_rank": None, "fit_reason": None})
    inbox = new = 0
    for rank, (p, pick) in enumerate(kept, 1):
        if p is not None:
            db.update("postings", {"id": p["id"]}, {"fit_rank": rank, "fit_reason": pick["reason"]})
            inbox += 1
            continue
        db.upsert("postings", [{
            "id": jobs.posting_id(_Job(pick)), "company": pick["company"], "title": pick["title"],
            "location": pick.get("location"), "url": pick["url"], "term": pick.get("term"), "posted_at": None,
            "tier": tier_of(pick["company"]), "starred": starred(pick.get("location")), "status": "new",
            "found_at": now.isoformat(), "fit_rank": rank, "fit_reason": pick["reason"], "found_by": "claude",
        }], on_conflict="id")
        new += 1
    return {"inbox": inbox, "new": new, "skipped": skipped, "unverified": unverified}


class _Job:
    """Just enough of job_radar's Job for jobs.posting_id."""

    def __init__(self, pick: dict):
        self.company, self.title, self.location = pick["company"], pick["title"], pick.get("location") or ""
