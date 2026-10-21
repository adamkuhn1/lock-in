"""SimplifyJobs GitHub README lists (New-Grad-Positions, SummerYYYY-Internships).

The README is fetched through the GitHub API in two steps:
  1. GET /repos/{repo}/readme        -> the README blob sha
  2. GET /repos/{repo}/git/blobs/sha -> the full file (raw)
The contents/readme endpoint silently truncates large files (~512 KB), but
the blobs endpoint does not. If the sha matches last run, nothing changed and
the download is skipped.

Rows are HTML <tr> elements under "## <section>" headings:
  <td>company (or "↳" = same as row above)</td><td>role</td>
  <td>location (or <details> with several)</td><td>apply links or 🔒</td><td>age</td>
Other community lists (SpeedyApply, vanshb03) use markdown pipe tables with the same
idea and slightly different column names ("Position", "Posting", "Date Posted"); those
parse too, with columns found from the header row.
"""

from __future__ import annotations

import html
import os
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..http import get, get_json
from ..models import FetchError, Job

API = "https://api.github.com/repos/{repo}"

_SECTION_RE = re.compile(r"^## (.+)$", re.M)
_ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
_CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_HREF_RE = re.compile(r'href="([^"]+)"')
_TAG_RE = re.compile(r"<[^>]+>")
_SIMPLIFY_POSTING_RE = re.compile(r"simplify\.jobs/p/([0-9a-f-]{36})")
_BR_RE = re.compile(r"</?br\s*/?>", re.I)
_SUMMARY_RE = re.compile(r"<summary>.*?</summary>", re.S)
_TH_RE = re.compile(r"<th[^>]*>(.*?)</th>", re.S)
# column positions when a table has no recognizable header
_DEFAULT_COLS = {"company": 0, "role": 1, "location": 2, "application": 3, "age": 4}
# header names per column, matched by prefix (markdown lists name them differently)
_ALIASES = {"company": ("company",), "role": ("role", "position", "job title", "title"), "location": ("location",),
            "terms": ("terms",), "application": ("application", "apply", "posting", "link"),
            "age": ("age", "date posted", "posted")}
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]+)\)")
_MD_SEP_RE = re.compile(r"^:?-{2,}:?$")


def _match_columns(names: list[str]) -> dict[str, int] | None:
    cols: dict[str, int] = {}
    for key, aliases in _ALIASES.items():
        for i, name in enumerate(names):
            if key not in cols and any(name.startswith(a) for a in aliases):
                cols[key] = i
    return cols if all(k in cols for k in ("company", "role", "location", "application")) else None


def _columns(table_html: str) -> dict[str, int]:
    names = [_TAG_RE.sub("", h).strip().lower() for h in _TH_RE.findall(table_html)]
    return _match_columns(names) or dict(_DEFAULT_COLS)


def _html_rows(body: str):
    cols = _columns(body)
    for row in _ROW_RE.finditer(body):
        yield cols, _CELL_RE.findall(row.group(1))


def _md(cell: str) -> str:
    """Markdown links and bold to plain text: [**Lyft**](https://…) → Lyft."""
    return _MD_LINK_RE.sub(r"\1", cell).replace("**", "")


def _md_rows(body: str):
    """Markdown pipe tables: a header row naming the columns, a --- row, then one row per job."""
    cols = None
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            cols = None  # anything else ends the table
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(_MD_SEP_RE.match(c) for c in cells if c):
            continue
        header = _match_columns([_text(_md(c)).lower() for c in cells])
        if header:
            cols = header
        elif cols:
            yield cols, cells


def _headers() -> dict:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch(source, session, prev_sha: str | None) -> tuple[list[Job] | None, str]:
    """Returns (jobs, sha). jobs is None when the README is unchanged since prev_sha."""
    base = API.format(repo=source.repo)
    meta_url = f"{base}/contents/{source.path}" if source.path else f"{base}/readme"
    meta = get_json(session, meta_url, headers=_headers())
    sha = meta.get("sha") if isinstance(meta, dict) else None
    if not sha:
        raise FetchError(f"simplify {source.repo}/{source.path or 'README'}: no sha in API response")
    if sha == prev_sha:
        return None, sha
    raw_headers = {**_headers(), "Accept": "application/vnd.github.raw"}
    resp = get(session, f"{base}/git/blobs/{sha}", headers=raw_headers)
    resp.encoding = "utf-8"
    return parse_readme(resp.text, source.sections), sha


def _text(cell: str) -> str:
    return " ".join(html.unescape(_TAG_RE.sub(" ", cell)).split())


def _location(cell: str) -> str:
    cell = _SUMMARY_RE.sub("", cell)
    parts = [_text(p) for p in _BR_RE.split(cell)]
    return "; ".join(p for p in parts if p)


def _strip_query(url: str) -> str:
    s = urlsplit(url)
    return urlunsplit((s.scheme, s.netloc, s.path.rstrip("/"), "", ""))


_TRACKING_PARAMS = {"embed", "gh_src", "lever-source", "source"}


def listing_url(url: str) -> str:
    """Turn a Simplify apply link into the posting's own page.

    Drops Simplify tracking params and, for Ashby/Lever, the application-form
    suffix so the tap opens the job description rather than the form."""
    s = urlsplit(url)
    query = [
        (k, v) for k, v in parse_qsl(s.query, keep_blank_values=True)
        if not k.lower().startswith("utm_")
        and k.lower() not in _TRACKING_PARAMS
        and not (k.lower() == "ref" and v.lower() == "simplify")
    ]
    path = s.path
    host = s.netloc.lower()
    if host == "jobs.ashbyhq.com" and path.rstrip("/").endswith("/application"):
        path = path.rstrip("/")[: -len("/application")]
    elif host == "jobs.lever.co" and path.rstrip("/").endswith("/apply"):
        path = path.rstrip("/")[: -len("/apply")]
    return urlunsplit((s.scheme, s.netloc, path, urlencode(query), s.fragment))


def parse_readme(text: str, sections: list[str] | None = None) -> list[Job]:
    """Parse open rows from the README. `sections` filters by heading substring
    (case-insensitive); None/empty means all sections."""
    wanted = [s.lower() for s in (sections or [])]
    headings = list(_SECTION_RE.finditer(text))
    jobs: list[Job] = []
    seen_ids: set[str] = set()
    total_rows = 0

    for i, heading in enumerate(headings):
        name = heading.group(1)
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        body = text[heading.end() : end]
        if wanted and not any(w in name.lower() for w in wanted):
            continue
        rows = _html_rows(body) if "<table" in body else _md_rows(body)
        company = ""
        for cols, cells in rows:
            if len(cells) < min(max(cols.values()) + 1, 4):  # header row uses <th>, has no <td>
                continue

            def cell(key):
                i = cols.get(key)
                return cells[i] if i is not None and i < len(cells) else None

            total_rows += 1
            name_cell = _text(_md(cell("company")))
            if name_cell != "↳":
                company = name_cell
            app_cell = cell("application") or ""
            if "🔒" in app_cell:
                continue  # closed
            hrefs = [html.unescape(h) for h in _HREF_RE.findall(app_cell) + [u for _, u in _MD_LINK_RE.findall(app_cell)]]
            hrefs = [h for h in hrefs if h.startswith(("http://", "https://"))]
            apply = [h for h in hrefs if "simplify.jobs/p/" not in h]
            url = apply[0] if apply else (hrefs[0] if hrefs else "")
            if not url:
                continue
            m = _SIMPLIFY_POSTING_RE.search(app_cell)
            # id derives from the RAW link so it stays stable across versions
            job_id = m.group(1) if m else _strip_query(url)
            if job_id in seen_ids:
                continue
            seen_ids.add(job_id)
            jobs.append(
                Job(
                    company=company,
                    title=_text(_md(cell("role"))),
                    location=_location(cell("location")),
                    url=listing_url(url),
                    posted_at=None,
                    id=job_id,
                    age=_text(cell("age")) if cell("age") else None,
                    term=_text(cell("terms")) if cell("terms") else None,
                )
            )

    if total_rows == 0:
        raise FetchError("simplify: parsed 0 table rows — README format may have changed")
    return jobs
