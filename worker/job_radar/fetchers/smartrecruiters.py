"""SmartRecruiters public postings API: https://developers.smartrecruiters.com/docs/posting-api

token: the company identifier from jobs.smartrecruiters.com/<token>. US postings only, paged.
"""

from __future__ import annotations

from ..http import get_json
from ..models import FetchError, Job

API = "https://api.smartrecruiters.com/v1/companies/{token}/postings"
PAGE_SIZE = 100
MAX_PAGES = 10


def fetch(company, session) -> list[Job]:
    jobs: list[Job] = []
    for page in range(MAX_PAGES):
        payload = get_json(session, API.format(token=company.token),
                           params={"limit": PAGE_SIZE, "offset": page * PAGE_SIZE, "country": "us"})
        batch = parse(payload, company.name, company.token)
        jobs += batch
        if len(batch) < PAGE_SIZE:
            break
    return jobs


def parse(payload, company_name: str, token: str) -> list[Job]:
    if not isinstance(payload, dict) or not isinstance(payload.get("content"), list):
        raise FetchError("smartrecruiters: unexpected response shape (no 'content' list)")
    jobs = []
    for raw in payload["content"]:
        loc = raw.get("location") or {}
        city_region = ", ".join(p for p in (loc.get("city"), loc.get("region")) if p)
        jobs.append(Job(
            company=company_name,
            title=(raw.get("name") or "").strip(),
            location=(loc.get("fullLocation") or city_region).strip(" ,"),
            url=f"https://jobs.smartrecruiters.com/{token}/{raw['id']}",
            posted_at=raw.get("releasedDate"),
            id=str(raw["id"]),
            places=tuple(p for p in (city_region, (loc.get("country") or "").upper()) if p),
        ))
    return jobs
