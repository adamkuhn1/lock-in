"""Ashby public job posting API: https://developers.ashbyhq.com/docs/public-job-posting-api"""

from __future__ import annotations

from ..http import get_json
from ..models import FetchError, Job

API = "https://api.ashbyhq.com/posting-api/job-board/{token}"


def fetch(company, session) -> list[Job]:
    return parse(get_json(session, API.format(token=company.token)), company.name)


def _places(raw) -> tuple[str, ...]:
    out = []
    for loc in [raw, *(raw.get("secondaryLocations") or [])]:
        if loc is not raw and loc.get("location"):
            out.append(loc["location"])
        addr = ((loc.get("address") or {}).get("postalAddress") or {})
        parts = [addr.get(k) for k in ("addressLocality", "addressRegion", "addressCountry")]
        if any(parts):
            out.append(", ".join(p for p in parts if p))
    return tuple(out)


def parse(payload, company_name: str) -> list[Job]:
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise FetchError("ashby: unexpected response shape (no 'jobs' list)")
    jobs = []
    for raw in payload["jobs"]:
        if raw.get("isListed") is False:
            continue
        jobs.append(
            Job(
                company=company_name,
                title=(raw.get("title") or "").strip(),
                location=(raw.get("location") or "").strip(),
                url=raw.get("jobUrl") or "",
                posted_at=raw.get("publishedAt"),
                id=str(raw["id"]),
                places=_places(raw),
            )
        )
    return jobs
