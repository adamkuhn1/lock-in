"""Lever public postings API: https://github.com/lever/postings-api"""

from __future__ import annotations

from datetime import datetime, timezone

from ..http import get_json
from ..models import FetchError, Job

API = "https://api.lever.co/v0/postings/{token}?mode=json"


def fetch(company, session) -> list[Job]:
    return parse(get_json(session, API.format(token=company.token)), company.name)


def _places(raw, categories) -> tuple[str, ...]:
    out = [loc for loc in categories.get("allLocations") or [] if isinstance(loc, str)]
    country = raw.get("country")
    if country == "US":
        out.append("United States")
    elif isinstance(country, str) and len(country) == 2:
        out.append(f"{country}-country")  # ISO code, read like Workday's "GB-London" prefix
    return tuple(out)


def parse(payload, company_name: str) -> list[Job]:
    if not isinstance(payload, list):
        raise FetchError("lever: unexpected response shape (expected a list)")
    jobs = []
    for raw in payload:
        created = raw.get("createdAt")
        posted_at = (
            datetime.fromtimestamp(created / 1000, tz=timezone.utc).isoformat()
            if isinstance(created, (int, float))
            else None
        )
        categories = raw.get("categories") or {}
        jobs.append(
            Job(
                company=company_name,
                title=(raw.get("text") or "").strip(),
                location=(categories.get("location") or "").strip(),
                url=raw.get("hostedUrl") or "",
                posted_at=posted_at,
                id=str(raw["id"]),
                places=_places(raw, categories),
            )
        )
    return jobs
