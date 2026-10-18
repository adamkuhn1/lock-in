"""Oracle Recruiting Cloud (Oracle HCM) career sites: JPMorgan, Uber and others.

token: "<host>/<site>/<US location id>", e.g. "jpmc.fa.oraclecloud.com/CX_1001/300000000289738".
The US location id is in the response's locationsFacet. A few early-career keyword searches, newest first.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..http import get_json
from ..models import FetchError, Job

QUERIES = ("2027", "intern", "new grad", "early career", "university", "graduate program")
LIMIT = 200
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
# Public job links: the site's own Candidate Experience page, unless a company fronts it with its own site.
JOB_URL = {"iaziqy.fa.ocs.oraclecloud.com": "https://jobs.uber.com/en/jobs/{id}/"}


def parse_token(token: str) -> tuple[str, str, str]:
    parts = token.split("/")
    if len(parts) != 3 or not all(parts):
        raise FetchError(f"oracle: token must look like 'host/site/locationId', got {token!r}")
    return parts[0], parts[1], parts[2]


def fetch(company, session) -> list[Job]:
    host, site, us = parse_token(company.token)
    url = f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
    seen: dict[str, Job] = {}
    for q in QUERIES:
        finder = (f'findReqs;siteNumber={site},facetsList=LOCATIONS,limit={LIMIT},keyword="{q}",'
                  f"locationId={us},sortBy=POSTING_DATES_DESC,offset=0")
        payload = get_json(session, url, params={"onlyData": "true", "expand": "requisitionList.secondaryLocations", "finder": finder},
                           headers={"User-Agent": BROWSER_UA, "Accept": "application/json"})
        for j in parse(payload, company.name, host, site):
            seen.setdefault(j.id, j)
    return list(seen.values())


def parse(payload, company_name: str, host: str, site: str) -> list[Job]:
    try:
        rows = payload["items"][0]["requisitionList"] if payload.get("items") else []
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise FetchError("oracle: unexpected response shape") from exc
    link = JOB_URL.get(host, f"https://{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{{id}}")
    jobs = []
    for r in rows:
        if not r.get("Id"):
            continue
        places = tuple(p for p in [r.get("PrimaryLocation")] + [s.get("Name") for s in r.get("secondaryLocations") or []] if p)
        posted = r.get("PostedDate")
        try:
            posted_at = datetime.strptime(posted, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc).isoformat() if posted else None
        except ValueError:
            posted_at = None
        jobs.append(Job(company=company_name, title=(r.get("Title") or "").strip(), location="; ".join(places),
                        url=link.format(id=r["Id"]), posted_at=posted_at, id=str(r["Id"]), places=places))
    return jobs
