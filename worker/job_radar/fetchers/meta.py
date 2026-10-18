"""Meta careers (metacareers.com GraphQL, as its search page calls it). token: unused, use "meta".

One request returns every open job (no paging, no posting dates); filters.yaml picks the early-career software
ones. Any `lsd` string is accepted. DOC_ID is the search query's persisted id and can change when Meta ships new
site code: if this starts failing with "unexpected response", find the new id in the /jobsearch JS bundles
(CareersJobSearchResultsDataQuery_candidate_portalRelayOperation).
"""

from __future__ import annotations

import json

import requests

from ..http import TIMEOUT
from ..models import FetchError, Job

URL = "https://www.metacareers.com/graphql"
DOC_ID = "27506805582236862"
LSD = "lockinjobradar"
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SEARCH = {"q": "", "divisions": [], "offices": [], "roles": [], "leadership_levels": [], "saved_jobs": [], "saved_searches": [],
          "sub_teams": [], "teams": [], "is_leadership": False, "is_remote_only": False, "sort_by_new": True, "page": 1,
          "results_per_page": None}


def fetch(company, session) -> list[Job]:
    data = {"lsd": LSD, "doc_id": DOC_ID, "fb_api_req_friendly_name": "CareersJobSearchResultsDataQuery",
            "variables": json.dumps({"search_input": SEARCH, "isLoggedIn": False, "viewasUserID": None})}
    headers = {"User-Agent": BROWSER_UA, "X-FB-LSD": LSD, "Origin": "https://www.metacareers.com",
               "Referer": "https://www.metacareers.com/jobsearch", "sec-fetch-site": "same-origin"}
    try:
        resp = session.post(URL, data=data, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise FetchError(f"request failed: {exc}") from exc
    if resp.status_code != 200:
        raise FetchError(f"HTTP {resp.status_code} from {URL}")
    return parse(resp.text, company.name)


def parse(text: str, company_name: str) -> list[Job]:
    try:  # the body is JSON (sometimes followed by more lines) even though it says text/html
        payload = json.loads(text.split("\n", 1)[0])
        block = next(v for k, v in (payload.get("data") or {}).items() if k.startswith("job_search"))
        rows = block["all_jobs"]
    except (ValueError, StopIteration, KeyError, TypeError, AttributeError) as exc:
        raise FetchError("meta: unexpected response (has DOC_ID changed?)") from exc
    jobs = []
    for r in rows:
        if not r.get("id"):
            continue
        places = tuple(r.get("locations") or ())
        jobs.append(Job(company=company_name, title=(r.get("title") or "").strip(), location="; ".join(places),
                        url=f"https://www.metacareers.com/profile/job_details/{r['id']}/", posted_at=None,
                        id=str(r["id"]), places=places))
    return jobs
