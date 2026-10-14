"""ntfy.sh publisher: POST https://ntfy.sh/<topic> with headers.

Header values must be latin-1 on the wire, so non-ASCII titles (the em dash in
"Company — Role") are sent as RFC 2047 encoded-words, which ntfy decodes.
"""

from __future__ import annotations

import base64
import re
from urllib.parse import urlsplit

import requests

NTFY_BASE = "https://ntfy.sh"


def _header(value: str) -> str:
    value = " ".join(value.split())  # no newlines in headers
    try:
        value.encode("ascii")
        return value
    except UnicodeEncodeError:
        return "=?UTF-8?B?" + base64.b64encode(value.encode("utf-8")).decode("ascii") + "?="


_UNSAFE_URL_CHARS = re.compile(r"[\x00-\x20\x7f]")


def safe_click_url(url: str | None) -> str | None:
    """Posting URLs come from third parties (the Simplify README is community-
    edited), so only pass plain http(s) links to the Click header. Anything else
    (javascript:, intent:, app deep links, embedded newlines) is dropped."""
    if not url:
        return None
    url = url.strip()
    if _UNSAFE_URL_CHARS.search(url) or len(url) > 2000:
        return None
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return None
    try:
        url.encode("ascii")  # IDN / non-ASCII paths must already be percent-encoded
    except UnicodeEncodeError:
        return None
    return url


class Notifier:
    def __init__(self, topic: str | None, session: requests.Session | None = None, dry_run: bool = False):
        if not dry_run and not topic:
            raise ValueError("NTFY_TOPIC is not set")
        self.topic = topic
        self.session = session or requests.Session()
        self.dry_run = dry_run
        self.sent: list[dict] = []

    def send(self, title: str, message: str, *, click: str | None = None,
             priority: str = "default", tags: list[str] | None = None) -> None:
        click = safe_click_url(click)
        record = {"title": title, "message": message, "click": click, "priority": priority, "tags": tags or []}
        if self.dry_run:
            print(f"[dry-run] ntfy {priority}: {title} | {message} | {click or ''}")
            self.sent.append(record)
            return
        headers = {"Title": _header(title), "Priority": priority}
        if click:
            headers["Click"] = click
        if tags:
            headers["Tags"] = ",".join(tags)
        resp = self.session.post(
            f"{NTFY_BASE}/{self.topic}",
            data=(message or " ").encode("utf-8"),
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        self.sent.append(record)
