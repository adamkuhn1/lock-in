"""jobs.apple.com: the search page embeds its results (__staticRouterHydrationData). token: unused, use "apple".

US internships (the Students team) plus a "2027" search. The page sometimes answers with 0 results for a
query that has results, so a 0 is retried once.
"""

from __future__ import annotations

import json
import re

from ..http import get
from ..models import FetchError, Job

URL = "https://jobs.apple.com/en-us/search"
SITE = "https://jobs.apple.com/en-us/details"
SEARCHES = ({"team": "internships-STDNT-INTRN"}, {"search": "2027"}, {"search": "new grad software"})
PAGES = 2  # 20 rows per page
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
DATA = re.compile(r'window\.__staticRouterHydrationData\s*=\s*JSON\.parse\((".*?")\);', re.S)


def fetch(company, session) -> list[Job]:
    seen: dict[str, Job] = {}
    for extra in SEARCHES:
        for page in range(1, PAGES + 1):
            params = {"location": "united-states-USA", "sort": "newest", "page": page, **extra}
            for _attempt in range(2):
                batch, total = parse(get(session, URL, params=params, headers={"User-Agent": BROWSER_UA}).text, company.name)
                if total:
                    break
            for j in batch:
                seen.setdefault(j.id, j)
            if page * 20 >= total or not batch:
                break
    return list(seen.values())


def parse(html: str, company_name: str) -> tuple[list[Job], int]:
    m = DATA.search(html)
    if not m:
        raise FetchError("apple: search data not found in the page (layout changed?)")
    try:
        search = json.loads(json.loads(m.group(1)))["loaderData"]["search"]
        rows, total = search.get("searchResults") or [], int(search.get("totalRecords") or 0)
    except (ValueError, KeyError, TypeError) as exc:
        raise FetchError(f"apple: unexpected search data: {exc}") from exc
    by_id: dict[str, dict] = {}
    for r in rows:  # one row per location: merge them
        pid = str(r.get("positionId") or "")
        if not pid:
            continue
        cur = by_id.setdefault(pid, {"row": r, "places": []})
        for loc in r.get("locations") or []:
            name = ", ".join(p for p in (loc.get("name"), loc.get("countryName")) if p)
            if name and name not in cur["places"]:
                cur["places"].append(name)
    jobs = []
    for pid, v in by_id.items():
        r, places = v["row"], tuple(v["places"])
        jobs.append(Job(
            company=company_name, title=(r.get("postingTitle") or "").strip(), location="; ".join(places),
            url=f"{SITE}/{pid}/{r.get('transformedPostingTitle') or ''}".rstrip("/"),
            posted_at=r.get("postDateInGMT"), id=pid, places=places,
        ))
    return jobs, total
