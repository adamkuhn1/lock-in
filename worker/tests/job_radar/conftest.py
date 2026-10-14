from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def fixture_json(name: str):
    return json.loads(fixture_text(name))


class FakeResponse:
    def __init__(self, status_code=200, body=None, text=None):
        self.status_code = status_code
        self._body = body
        self.text = text if text is not None else json.dumps(body)
        self.encoding = "utf-8"

    def json(self):
        if self._body is None:
            return json.loads(self.text)
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    """Routes exact URLs to canned responses and records every call."""

    def __init__(self, routes: dict[str, FakeResponse] | None = None):
        self.routes = routes or {}
        self.calls: list[tuple[str, str, dict]] = []

    def get(self, url, timeout=None, headers=None, **_):
        self.calls.append(("GET", url, headers or {}))
        if url not in self.routes:
            return FakeResponse(404, {"error": "not found"})
        return self.routes[url]

    def post(self, url, data=None, headers=None, timeout=None, **_):
        self.calls.append(("POST", url, {"headers": headers, "data": data}))
        return self.routes.get(url, FakeResponse(200, {}))


@pytest.fixture
def fake_session():
    return FakeSession()
