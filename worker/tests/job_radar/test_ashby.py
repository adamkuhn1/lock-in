import pytest

from job_radar.config import Company
from job_radar.fetchers import ashby
from job_radar.models import FetchError

from .conftest import FakeResponse, FakeSession, fixture_json

RAMP = Company("Ramp", "ashby", "ramp", "A")
URL = "https://api.ashbyhq.com/posting-api/job-board/ramp"


def test_parse_sample_response():
    jobs = ashby.parse(fixture_json("ashby_ramp.json"), "Ramp")
    assert len(jobs) == 6
    titles = [j.title for j in jobs]
    assert "Security Engineer, Cloud" in titles  # leading whitespace stripped
    job = jobs[0]
    assert job.company == "Ramp"
    assert job.url.startswith("https://jobs.ashbyhq.com/ramp/")
    assert job.id in job.url
    assert job.posted_at.startswith("20")


def test_unlisted_jobs_are_skipped():
    payload = {"jobs": [
        {"id": "1", "title": "Intern", "location": "NYC", "jobUrl": "u1", "isListed": True},
        {"id": "2", "title": "Hidden", "location": "NYC", "jobUrl": "u2", "isListed": False},
    ]}
    assert [j.id for j in ashby.parse(payload, "Co")] == ["1"]


def test_fetch_uses_board_token():
    session = FakeSession({URL: FakeResponse(200, fixture_json("ashby_ramp.json"))})
    assert len(ashby.fetch(RAMP, session)) == 6
    assert session.calls[0][1] == URL


def test_bad_token_raises_fetch_error():
    with pytest.raises(FetchError, match="404"):
        ashby.fetch(RAMP, FakeSession())


def test_unexpected_shape_raises():
    with pytest.raises(FetchError):
        ashby.parse([], "Ramp")
