from __future__ import annotations

import requests

from .models import FetchError

TIMEOUT = 30
USER_AGENT = "job-radar/1.0 (+personal job alert bot)"


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    return session


def get(session: requests.Session, url: str, **kwargs) -> requests.Response:
    try:
        resp = session.get(url, timeout=TIMEOUT, **kwargs)
    except requests.RequestException as exc:
        raise FetchError(f"request failed: {exc}") from exc
    if resp.status_code != 200:
        raise FetchError(f"HTTP {resp.status_code} from {url}")
    return resp


def get_json(session: requests.Session, url: str, **kwargs):
    resp = get(session, url, **kwargs)
    try:
        return resp.json()
    except ValueError as exc:
        raise FetchError(f"invalid JSON from {url}") from exc
