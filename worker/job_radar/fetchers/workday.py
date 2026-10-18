"""Workday career sites (the public CXS endpoint every *.myworkdayjobs.com site uses).

token: "<tenant>.<wdN>/<site>", e.g. "nvidia.wd5/NVIDIAExternalCareerSite"
(from https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite).

Big boards list thousands of jobs and only page 20 at a time, so instead of reading
everything we run a few early-career searches (results come back by relevance) and
let filters.yaml decide. That keeps it to a handful of requests per company per run.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import requests

from ..http import TIMEOUT
from ..models import FetchError, Job

API = "https://{host}/wday/cxs/{tenant}/{site}/jobs"
QUERIES = ("new grad", "intern", "2027", "university graduate")
PAGES = 2  # per query
PAGE_SIZE = 20  # Workday's maximum
TOKEN = re.compile(r"^([a-z0-9-]+)\.(wd\d+)/([A-Za-z0-9_-]+)$")
DAYS_AGO = re.compile(r"Posted (\d+) Days? Ago", re.I)


def parse_token(token: str) -> tuple[str, str, str]:
    m = TOKEN.match(token)
    if not m:
        raise FetchError(f"workday: token must look like 'tenant.wd5/Site', got {token!r}")
    tenant, wd, site = m.groups()
    return f"{tenant}.{wd}.myworkdayjobs.com", tenant, site


def posted_at(text: str | None, now: datetime) -> str | None:
    """"Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" → an ISO day; "30+ Days Ago" → unknown."""
    t = (text or "").strip()
    if re.search(r"today", t, re.I):
        days = 0
    elif re.search(r"yesterday", t, re.I):
        days = 1
    elif (m := DAYS_AGO.search(t)) and "+" not in t:
        days = int(m.group(1))
    else:
        return None
    day = (now - timedelta(days=days)).date()
    return datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc).isoformat()


def fetch(company, session, now: datetime | None = None) -> list[Job]:
    host, tenant, site = parse_token(company.token)
    url = API.format(host=host, tenant=tenant, site=site)
    now = now or datetime.now(timezone.utc)
    seen: dict[str, Job] = {}
    for q in QUERIES:
        for page in range(PAGES):
            body = {"appliedFacets": {}, "limit": PAGE_SIZE, "offset": page * PAGE_SIZE, "searchText": q}
            try:
                resp = session.post(url, json=body, timeout=TIMEOUT, headers={"Accept": "application/json"})
            except requests.RequestException as exc:
                raise FetchError(f"request failed: {exc}") from exc
            if resp.status_code != 200:
                raise FetchError(f"HTTP {resp.status_code} from {url}")
            try:
                payload = resp.json()
            except ValueError as exc:
                raise FetchError(f"invalid JSON from {url}") from exc
            batch = parse(payload, company.name, host, site, now)
            for j in batch:
                seen.setdefault(j.id, j)
            if len(batch) < PAGE_SIZE:
                break
    return list(seen.values())


def parse(payload, company_name: str, host: str, site: str, now: datetime) -> list[Job]:
    if not isinstance(payload, dict) or not isinstance(payload.get("jobPostings"), list):
        raise FetchError("workday: unexpected response shape (no 'jobPostings' list)")
    jobs = []
    for raw in payload["jobPostings"]:
        path = raw.get("externalPath")
        if not path:
            continue
        jobs.append(Job(
            company=company_name,
            title=(raw.get("title") or "").strip(),
            location=(raw.get("locationsText") or "").strip(),
            url=f"https://{host}/{site}{path}",
            posted_at=posted_at(raw.get("postedOn"), now),
            id=path,
        ))
    return jobs
