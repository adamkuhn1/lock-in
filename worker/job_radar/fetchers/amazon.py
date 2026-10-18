"""amazon.jobs search JSON (what the site's own search page calls). token: unused, use "amazon".

US software-development postings for a few early-career searches; filters.yaml makes the final call.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from ..http import get_json
from ..models import FetchError, Job

API = "https://www.amazon.jobs/en/search.json"
SITE = "https://www.amazon.jobs"
QUERIES = ("early career", "2027", "intern", "new grad")
CATEGORIES = ("software-development", "machine-learning-science")
LIMIT = 100  # the API's maximum
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def posted_at(text: str | None) -> str | None:
    """"October  9, 2026" (note the double space) → ISO; anything else → unknown."""
    try:
        d = datetime.strptime(re.sub(r"\s+", " ", (text or "").strip()), "%B %d, %Y")
    except ValueError:
        return None
    return d.replace(hour=12, tzinfo=timezone.utc).isoformat()


def fetch(company, session) -> list[Job]:
    seen: dict[str, Job] = {}
    for q in QUERIES:
        params = {"base_query": q, "country": "USA", "category[]": list(CATEGORIES), "result_limit": LIMIT, "offset": 0, "sort": "recent"}
        for j in parse(get_json(session, API, params=params, headers={"User-Agent": BROWSER_UA}), company.name):
            seen.setdefault(j.id, j)
    return list(seen.values())


def parse(payload, company_name: str) -> list[Job]:
    if not isinstance(payload, dict):
        raise FetchError("amazon: unexpected response shape")
    if payload.get("error"):
        raise FetchError(f"amazon: {payload['error']}"[:200])
    if not isinstance(payload.get("jobs"), list):
        raise FetchError("amazon: unexpected response shape (no 'jobs' list)")
    jobs = []
    for raw in payload["jobs"]:
        jid = str(raw.get("id_icims") or raw.get("id") or "")
        if not jid or not raw.get("job_path"):
            continue
        jobs.append(Job(
            company=company_name,
            title=(raw.get("title") or "").strip(),
            location=(raw.get("normalized_location") or raw.get("location") or "").strip(),
            url=SITE + raw["job_path"],
            posted_at=posted_at(raw.get("posted_date")),
            id=jid,
            places=tuple(p for p in (raw.get("country_code"),) if p),
        ))
    return jobs
