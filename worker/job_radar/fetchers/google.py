"""Google careers: the results page embeds its data (AF_initDataCallback 'ds:1'). token: unused, use "google".

A few early-career software searches, US only, by relevance; filters.yaml makes the final call.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from ..http import get
from ..models import FetchError, Job

URL = "https://www.google.com/about/careers/applications/jobs/results"
SEARCHES = (  # by relevance: sorting by date buries these under brand-new unrelated roles
    {"q": "software engineer early career"}, {"q": "software engineer university graduate"},
    {"q": "software engineer new grad 2027"}, {"q": "software", "employment_type": "INTERN"},
)
PAGES = 2  # 20 per page
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
DATA = re.compile(r"AF_initDataCallback\(\{key: 'ds:1', hash: '[^']*', data:(.*?), sideChannel: \{\}\}\);</script>", re.S)


def fetch(company, session) -> list[Job]:
    seen: dict[str, Job] = {}
    for extra in SEARCHES:
        for page in range(1, PAGES + 1):
            params = {"location": "United States", "page": page, **extra}
            html = get(session, URL, params=params, headers={"User-Agent": BROWSER_UA}).text
            batch, total = parse(html, company.name)
            for j in batch:
                seen.setdefault(j.id, j)
            if page * 20 >= total or not batch:
                break
    return list(seen.values())


def parse(html: str, company_name: str) -> tuple[list[Job], int]:
    m = DATA.search(html)
    if not m:
        raise FetchError("google: results data not found in the page (layout changed?)")
    try:
        d = json.loads(m.group(1))
        rows, total = d[0] or [], int(d[2] or 0)
    except (ValueError, IndexError, TypeError) as exc:
        raise FetchError(f"google: unexpected results data: {exc}") from exc
    jobs = []
    for j in rows:
        try:
            jid, title = str(j[0]), str(j[1]).strip()
        except (IndexError, TypeError):
            continue
        places = tuple(loc[0] for loc in (j[9] if len(j) > 9 and j[9] else []) if loc and loc[0])
        ts = j[12][0] if len(j) > 12 and j[12] else None
        jobs.append(Job(
            company=company_name, title=title, location="; ".join(places),
            url=f"{URL}/{jid}",
            posted_at=datetime.fromtimestamp(ts, timezone.utc).isoformat() if isinstance(ts, (int, float)) else None,
            id=jid, places=places,
        ))
    return jobs, total
