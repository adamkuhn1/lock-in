"""Exact posting times for alerts.

Company boards give a timestamp directly. Simplify rows only carry a coarse
age ("0d"), so for rows whose link points at a Greenhouse / Lever / Ashby
posting we ask that board for the real publish time. Only called for postings
about to be alerted, so it's a handful of small requests per run.
"""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from .http import get_json
from .models import Job

ET = ZoneInfo("America/New_York")
OLD_AFTER_DAYS = 3  # flag postings older than this as "not actually new"

_GH_PATH = re.compile(r"^/([^/]+)/jobs/(\d+)")
_UUID_PATH = re.compile(r"^/([^/]+)/([0-9a-f-]{36})", re.I)


def _greenhouse(token: str, job_id: str, session, _cache) -> str | None:
    data = get_json(session, f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}")
    return data.get("first_published")


def _lever(token: str, job_id: str, session, _cache) -> str | None:
    data = get_json(session, f"https://api.lever.co/v0/postings/{token}/{job_id}?mode=json")
    created = data.get("createdAt")
    if isinstance(created, (int, float)):
        return datetime.fromtimestamp(created / 1000, tz=timezone.utc).isoformat()
    return None


def _ashby(token: str, job_id: str, session, cache: dict) -> str | None:
    # Ashby has no single-posting endpoint; fetch the board once per run.
    key = f"ashby:{token}"
    if key not in cache:
        board = get_json(session, f"https://api.ashbyhq.com/posting-api/job-board/{token}")
        cache[key] = {j.get("id"): j.get("publishedAt") for j in board.get("jobs", [])}
    return cache[key].get(job_id)


def ats_lookup(url: str):
    """Map a posting URL to (resolver, token, job_id), or None if unsupported."""
    s = urlsplit(url)
    host = s.netloc.lower()
    if host in ("job-boards.greenhouse.io", "boards.greenhouse.io"):
        m = _GH_PATH.match(s.path)
        if m:
            return _greenhouse, m.group(1), m.group(2)
        gh_jid = parse_qs(s.query).get("gh_jid")
        token = s.path.strip("/").split("/")[0]
        if gh_jid and token:
            return _greenhouse, token, gh_jid[0]
    if host == "jobs.lever.co":
        m = _UUID_PATH.match(s.path)
        if m:
            return _lever, m.group(1), m.group(2)
    if host == "jobs.ashbyhq.com":
        m = _UUID_PATH.match(s.path)
        if m:
            return _ashby, m.group(1), m.group(2)
    return None


def resolve(job: Job, session, cache: dict, log=print) -> Job:
    """Fill job.posted_at from the employer's board when the source lacked it."""
    if job.posted_at or session is None:
        return job
    found = ats_lookup(job.url)
    if not found:
        return job
    fn, token, job_id = found
    try:
        posted = fn(token, job_id, session, cache)
    except Exception as exc:  # best effort — never block an alert on this
        log(f"posted-time lookup failed for {job.url}: {exc}")
        return job
    return replace(job, posted_at=posted) if posted else job


def _parse(iso: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ago(delta_s: float) -> str:
    minutes = max(0, int(delta_s // 60))
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    if hours < 48:
        return f"{hours} hr ago"
    return f"{hours // 24} days ago"


_AGE_RE = re.compile(r"^(\d+)\s*(d|mo|w|h)$", re.I)


def _age_text(age: str) -> str:
    m = _AGE_RE.match(age.strip())
    if not m:
        return f"age {age}"
    n, unit = int(m.group(1)), m.group(2).lower()
    if unit == "d" and n == 0:
        return "today"
    if unit == "h":
        return f"{n} hr ago"
    name = {"d": "day", "w": "week", "mo": "month"}[unit]
    return f"{n} {name}{'s' if n != 1 else ''} ago"


def posted_line(job: Job, now: datetime) -> str:
    """e.g. 'Posted Oct 7, 11:52 AM ET (14 min ago)'."""
    dt = _parse(job.posted_at) if job.posted_at else None
    if dt:
        local = dt.astimezone(ET)
        when = local.strftime("%b %-d, %-I:%M %p ET")
        delta = (now - dt).total_seconds()
        line = f"Posted {when} ({_ago(delta)})"
        if delta > OLD_AFTER_DAYS * 86400:
            line = f"⚠️ {line} — older posting, newly listed"
        return line
    if job.age:
        return f"Added to SimplifyJobs list {_age_text(job.age)} (exact post time not published)"
    return "Post time not published by this board"
