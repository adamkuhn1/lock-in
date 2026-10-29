"""The full text of a posting, for the checks in screen.py.

Greenhouse, Lever and Ashby publish descriptions through the same public APIs the scanner reads. Other boards
(Workday, the big-tech sites) return None, and their postings are judged on the title alone."""

from __future__ import annotations

import html
import re

from .http import get_json
from .posted import ats_lookup

_TAG = re.compile(r"<[^>]+>")
_BLOCK = re.compile(r"</?(p|div|li|ul|ol|br|h[1-6]|tr)\b[^>]*>", re.I)


def html_text(raw: str | None) -> str:
    """Greenhouse double-escapes its HTML, so unescape, drop tags (block tags become line breaks), unescape again."""
    s = html.unescape(raw or "")
    s = _BLOCK.sub("\n", s)
    s = html.unescape(_TAG.sub(" ", s))
    return "\n".join(" ".join(line.split()) for line in s.splitlines() if line.strip())


def _greenhouse(token: str, job_id: str, session, cache: dict) -> str | None:
    data = get_json(session, f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}")
    return html_text(data.get("content"))


def _lever(token: str, job_id: str, session, cache: dict) -> str | None:
    data = get_json(session, f"https://api.lever.co/v0/postings/{token}/{job_id}?mode=json")
    parts = [data.get("descriptionPlain") or ""]
    for block in data.get("lists") or []:
        parts.append(f"{block.get('text') or ''}\n{html_text(block.get('content'))}")
    parts.append(data.get("additionalPlain") or "")
    return "\n".join(p for p in parts if p.strip())


def _ashby(token: str, job_id: str, session, cache: dict) -> str | None:
    # No single-posting endpoint: read the board once per run.
    key = f"ashby-text:{token}"
    if key not in cache:
        board = get_json(session, f"https://api.ashbyhq.com/posting-api/job-board/{token}")
        cache[key] = {j.get("id"): j.get("descriptionPlain") or html_text(j.get("descriptionHtml"))
                      for j in board.get("jobs") or []}
    return cache[key].get(job_id)


_BY_ATS = {"greenhouse": _greenhouse, "lever": _lever, "ashby": _ashby}
_BY_RESOLVER = {"_greenhouse": _greenhouse, "_lever": _lever, "_ashby": _ashby}


def target(job, ats: str | None = None, token: str | None = None):
    """(fetcher, token, job id) for this posting, or None when its board has no public description API."""
    if ats in _BY_ATS and token:
        return _BY_ATS[ats], token, job.id
    found = ats_lookup(job.url or "")
    if not found:
        return None
    resolver, tok, jid = found
    return _BY_RESOLVER[resolver.__name__], tok, jid


def fetch_text(job, session, cache: dict, ats: str | None = None, token: str | None = None) -> str | None:
    t = target(job, ats, token)
    if t is None or session is None:
        return None
    fn, tok, jid = t
    return fn(tok, jid, session, cache)
