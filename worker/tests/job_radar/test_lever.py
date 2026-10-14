import pytest

from job_radar.config import Company
from job_radar.fetchers import lever
from job_radar.models import FetchError

from .conftest import FakeResponse, FakeSession, fixture_json

PALANTIR = Company("Palantir", "lever", "palantir", "A")
URL = "https://api.lever.co/v0/postings/palantir?mode=json"


def test_parse_sample_response():
    jobs = lever.parse(fixture_json("lever_palantir.json"), "Palantir")
    assert len(jobs) == 6
    first = jobs[0]
    assert first.company == "Palantir"
    assert first.title == "Deployment Strategist, Internship"
    assert first.url.startswith("https://jobs.lever.co/palantir/")
    assert first.id in first.url
    assert first.location


def test_created_at_millis_become_iso_utc():
    payload = [{"id": "abc", "text": "Intern", "createdAt": 1786469891368,
                "categories": {"location": "NYC"}, "hostedUrl": "u"}]
    assert lever.parse(payload, "Co")[0].posted_at.startswith("2026-08-11T")


def test_fetch_uses_board_token():
    session = FakeSession({URL: FakeResponse(200, fixture_json("lever_palantir.json"))})
    assert len(lever.fetch(PALANTIR, session)) == 6
    assert session.calls[0][1] == URL


def test_bad_token_raises_fetch_error():
    # Lever answers 404 {"ok": false, "error": "Document not found"}
    session = FakeSession({URL: FakeResponse(404, {"ok": False, "error": "Document not found"})})
    with pytest.raises(FetchError, match="404"):
        lever.fetch(PALANTIR, session)


def test_unexpected_shape_raises():
    with pytest.raises(FetchError):
        lever.parse({"ok": False}, "Palantir")
