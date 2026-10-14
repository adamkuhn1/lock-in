"""Greenhouse public job board API: https://developers.greenhouse.io/job-board.html"""

from __future__ import annotations

from ..http import get_json
from ..models import FetchError, Job

# content=true is the only way the list endpoint includes `offices`, which hold the
# real city when `location` is just "Hybrid" / "N/A" (Cloudflare, Stripe).
API = "https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"


def fetch(company, session) -> list[Job]:
    return parse(get_json(session, API.format(token=company.token)), company.name)


def parse(payload, company_name: str) -> list[Job]:
    if not isinstance(payload, dict) or not isinstance(payload.get("jobs"), list):
        raise FetchError("greenhouse: unexpected response shape (no 'jobs' list)")
    jobs = []
    for raw in payload["jobs"]:
        location = (raw.get("location") or {}).get("name") or ""
        jobs.append(
            Job(
                company=company_name,
                title=(raw.get("title") or "").strip(),
                location=location.strip(),
                url=raw.get("absolute_url") or "",
                posted_at=raw.get("first_published"),  # updated_at is NOT a posting time
                id=str(raw["id"]),
                places=tuple(o["name"] for o in raw.get("offices") or [] if o.get("name")),
            )
        )
    return jobs
