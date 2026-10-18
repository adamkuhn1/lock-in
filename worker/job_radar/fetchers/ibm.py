"""IBM careers search API (what careers.ibm.com calls). token: unused, use "ibm". Internship and Entry Level roles."""

from __future__ import annotations

from datetime import datetime, timezone

import requests

from ..http import TIMEOUT
from ..models import FetchError, Job

URL = "https://www-api.ibm.com/search/api/v2"
PAGE = 100
MAX_PAGES = 6
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def fetch(company, session) -> list[Job]:
    jobs: list[Job] = []
    for page in range(MAX_PAGES):
        body = {"appId": "careers", "scopes": ["careers2"], "size": PAGE, "from": page * PAGE, "lang": "zz",
                "query": {"bool": {"must": [], "filter": [{"terms": {"field_keyword_18": ["Internship", "Entry Level"]}}]}},
                "_source": ["title", "url", "field_keyword_08", "field_keyword_19", "dcdate"]}
        try:
            resp = session.post(URL, json=body, headers={"User-Agent": BROWSER_UA, "Accept": "application/json"}, timeout=TIMEOUT)
        except requests.RequestException as exc:
            raise FetchError(f"request failed: {exc}") from exc
        if resp.status_code != 200:
            raise FetchError(f"HTTP {resp.status_code} from {URL}")
        try:
            hits = resp.json()["hits"]
        except (ValueError, KeyError, TypeError) as exc:
            raise FetchError("ibm: unexpected response shape") from exc
        batch = parse(hits, company.name)
        jobs += batch
        if len(hits.get("hits") or []) < PAGE or (page + 1) * PAGE >= int((hits.get("total") or {}).get("value") or 0):
            break
    return jobs


def parse(hits, company_name: str) -> list[Job]:
    if not isinstance(hits, dict) or not isinstance(hits.get("hits"), list):
        raise FetchError("ibm: unexpected response shape (no hits list)")
    jobs = []
    for h in hits["hits"]:
        src = h.get("_source") or {}
        url = src.get("url")
        if not url:
            continue
        day = src.get("dcdate")
        try:
            posted_at = datetime.strptime(day[:10], "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc).isoformat() if day else None
        except ValueError:
            posted_at = None
        # "City, CC" with a country code: "Markham, CA" is Canada, not California. Keep US jobs only.
        city, _, cc = (src.get("field_keyword_19") or "").strip().rpartition(",")
        if cc.strip().upper() != "US":
            continue
        loc = f"{city.strip().title()}, United States"
        jobs.append(Job(company=company_name, title=(src.get("title") or "").strip(), location=loc, url=url,
                        posted_at=posted_at, id=str(h.get("_id") or url), places=(loc,)))
    return jobs
