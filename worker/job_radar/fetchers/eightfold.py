"""Eightfold career sites: Microsoft (apply.careers.microsoft.com), Netflix, Qualcomm and others.

token: "<host>/<domain>", e.g. "apply.careers.microsoft.com/microsoft.com".
Two generations of the API exist:
  - apply/v2 (older sites, e.g. Netflix): /api/apply/v2/jobs, no cookies needed.
  - PCSX (newer sites): /api/pcsx/search. Some need the site's cookies first (GET /careers), else 429.
    Older sites answer PCSX fine; newer ones answer apply/v2 with 403, so v2 is tried first.
Pages are fixed at 10 results. Free-text search is fuzzy, so filters.yaml makes the final call.
"""

from __future__ import annotations

import re
import time
from dataclasses import replace
from datetime import datetime, timezone

from ..http import get_json
from ..models import FetchError, Job

BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
PAGE = 10
MAX_PAGES = 3  # per search
PAUSE_S = 1.0  # between requests: these sites rate-limit bursts quickly
SLEEP = time.sleep  # injectable for tests
QUERIES = ("intern", "new grad", "university", "early career", "2027")
# Sites whose own filters beat free text: (extra params, term hint). Microsoft's entry-level titles are often just
# "Software Engineer", so its Entry tag becomes the term "Entry level", which filters.yaml's include rules
# recognize. The tag is sometimes wrong, so titles with a level number (II, III, 2) never get the hint.
FILTERED = {
    "microsoft.com": (
        ({"query": "", "filter_profession": "software engineering", "filter_seniority": "Entry"}, "Entry level"),
        ({"query": "", "filter_profession": "software engineering", "filter_seniority": "Intern"}, None),
        ({"query": "", "filter_seniority": "Intern"}, None),
    ),
}
LEVELED = re.compile(r"\b(ii|iii|iv|[2-9])\b", re.I)


def parse_token(token: str) -> tuple[str, str]:
    host, _, domain = token.partition("/")
    if not host or not domain or "/" in domain:
        raise FetchError(f"eightfold: token must look like 'host/domain', got {token!r}")
    return host, domain


class _Pager:
    """Paced requests; a 429 after the first request ends the run quietly with what was read."""

    def __init__(self, session):
        self.session, self.first, self.stopped = session, True, False

    def get(self, url, params):
        if not self.first:
            SLEEP(PAUSE_S)
        try:
            return get_json(self.session, url, params=params, headers={"User-Agent": BROWSER_UA, "Accept": "application/json"})
        except FetchError as exc:
            if self.first or "HTTP 429" not in str(exc):
                raise
            self.stopped = True
            return None
        finally:
            self.first = False


def fetch(company, session) -> list[Job]:
    host, domain = parse_token(company.token)
    pager, seen = _Pager(session), {}
    if domain in FILTERED:
        searches = FILTERED[domain]
        mode = "pcsx"
    else:
        searches = tuple(({"query": q}, None) for q in QUERIES)
        mode = "v2"
    for extra, hint in searches:
        for page in range(MAX_PAGES):
            batch, total = _page(pager, company.name, host, domain, mode, extra, page)
            if batch is None and mode == "v2":  # newer site: switch to PCSX (with its cookies) and redo this page
                mode = "pcsx"
                _warm(session, host, domain)
                batch, total = _page(pager, company.name, host, domain, mode, extra, page)
            if pager.stopped or batch is None:
                return list(seen.values())
            for j in batch:
                if hint and not LEVELED.search(j.title):
                    j = replace(j, term=hint)
                seen.setdefault(j.id, j)
            if len(batch) < PAGE or (page + 1) * PAGE >= total:
                break
    return list(seen.values())


def _warm(session, host, domain):
    try:  # sets the site's cookies on the shared session; PCSX answers 429 without them on some sites
        session.get(f"https://{host}/careers", params={"domain": domain}, headers={"User-Agent": BROWSER_UA, "Accept": "text/html"}, timeout=30)
    except Exception:
        pass


def _page(pager, name, host, domain, mode, extra, page):
    if mode == "v2":
        params = {"domain": domain, "start": page * PAGE, "num": PAGE, "sort_by": "timestamp", **extra}
        try:
            payload = pager.get(f"https://{host}/api/apply/v2/jobs", params)
        except FetchError as exc:
            if "HTTP 403" in str(exc):
                pager.first = True  # the switch to PCSX gets a fresh first request
                return None, 0
            raise
        return (parse_v2(payload, name, host) if payload is not None else (None, 0))
    params = {"domain": domain, "location": "United States", "start": page * PAGE, "sort_by": "timestamp", **extra}
    payload = pager.get(f"https://{host}/api/pcsx/search", params)
    return parse(payload, name, host) if payload is not None else (None, 0)


def _ts(v):
    return datetime.fromtimestamp(v, timezone.utc).isoformat() if isinstance(v, (int, float)) else None


def parse(payload, company_name: str, host: str) -> tuple[list[Job], int]:
    """PCSX: data.positions[] with standardizedLocations / postedTs / positionUrl."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or not isinstance(data.get("positions"), list):
        raise FetchError("eightfold: unexpected response shape (no data.positions list)")
    jobs = []
    for raw in data["positions"]:
        if raw.get("id") is None:
            continue
        places = tuple(raw.get("standardizedLocations") or raw.get("locations") or ())
        jobs.append(Job(
            company=company_name, title=(raw.get("name") or "").strip(), location="; ".join(places),
            url=f"https://{host}{raw.get('positionUrl') or '/careers/job/' + str(raw['id'])}",
            posted_at=_ts(raw.get("postedTs")), id=str(raw["id"]), places=places,
        ))
    return jobs, int(data.get("count") or 0)


def parse_v2(payload, company_name: str, host: str) -> tuple[list[Job], int]:
    """apply/v2: positions[] with location / locations / t_create / canonicalPositionUrl."""
    if not isinstance(payload, dict) or not isinstance(payload.get("positions"), list):
        raise FetchError("eightfold: unexpected response shape (no positions list)")
    jobs = []
    for raw in payload["positions"]:
        if raw.get("id") is None:
            continue
        places = tuple(raw.get("locations") or ([raw["location"]] if raw.get("location") else []))
        jobs.append(Job(
            company=company_name, title=(raw.get("name") or "").strip(), location="; ".join(places),
            url=raw.get("canonicalPositionUrl") or f"https://{host}/careers/job/{raw['id']}",
            posted_at=_ts(raw.get("t_create")), id=str(raw["id"]), places=places,
        ))
    return jobs, int(payload.get("count") or 0)
