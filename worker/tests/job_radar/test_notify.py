import base64

import pytest

from job_radar.notify import Notifier

from .conftest import FakeSession


def test_post_shape():
    session = FakeSession()
    Notifier("my-topic", session).send("Stripe — SWE Intern", "SF, CA", click="https://x/y", priority="high")
    method, url, req = session.calls[0]
    assert (method, url) == ("POST", "https://ntfy.sh/my-topic")
    h = req["headers"]
    assert h["Click"] == "https://x/y" and h["Priority"] == "high"
    assert req["data"] == "SF, CA".encode()
    # em dash is not latin-1 → RFC 2047 encoded-word, which ntfy decodes
    assert h["Title"].startswith("=?UTF-8?B?")
    assert base64.b64decode(h["Title"][10:-2]).decode() == "Stripe — SWE Intern"
    h["Title"].encode("latin-1")  # must be sendable


def test_ascii_title_sent_plain():
    session = FakeSession()
    Notifier("t", session).send("radar alive: 3 new today", "ok")
    assert session.calls[0][2]["headers"]["Title"] == "radar alive: 3 new today"
    assert "Click" not in session.calls[0][2]["headers"]


def test_requires_topic_unless_dry_run():
    with pytest.raises(ValueError):
        Notifier(None)
    n = Notifier(None, dry_run=True)
    n.send("t", "m")
    assert n.sent[0]["title"] == "t"


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "intent://evil#Intent;scheme=x;end",
    "ntfy://other-topic",
    "https://ok.example/a\r\nX-Injected: 1",
    "https://ok.example/a b",
    "https://exämple.com/x",
    "//no-scheme.example",
    "",
    None,
])
def test_unsafe_click_urls_dropped(url):
    session = FakeSession()
    Notifier("t", session).send("Co — Role", "NYC", click=url)
    headers = session.calls[0][2]["headers"]
    assert "Click" not in headers
    assert "\n" not in "".join(headers.values())


def test_safe_click_url_kept_and_trimmed():
    session = FakeSession()
    Notifier("t", session).send("Co — Role", "NYC", click="  https://jobs.lever.co/x/1?utm_source=Simplify  ")
    assert session.calls[0][2]["headers"]["Click"] == "https://jobs.lever.co/x/1?utm_source=Simplify"
