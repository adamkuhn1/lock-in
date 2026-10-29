import pytest

from job_radar.config import Company
from job_radar.fetchers import greenhouse
from job_radar.models import FetchError, Job

from .conftest import FakeResponse, FakeSession, fixture_json

STRIPE = Company("Stripe", "greenhouse", "stripe", "reach")
URL = "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true"


def test_parse_sample_response():
    jobs = greenhouse.parse(fixture_json("greenhouse_stripe.json"), "Stripe")
    assert len(jobs) == 6
    first = jobs[0]
    assert isinstance(first, Job)
    assert first.company == "Stripe"
    assert first.title == "Data Analyst, Intern"
    assert first.location
    assert first.url.startswith("https://stripe.com/jobs/")
    assert first.id.isdigit()  # int ids normalized to str
    assert first.posted_at and first.posted_at.startswith("20")


def test_posted_at_is_first_published_never_updated_at():
    payload = {"jobs": [
        {"id": 1, "title": "X", "location": {"name": "NYC"}, "absolute_url": "u",
         "first_published": "2026-01-01T00:00:00Z", "updated_at": "2026-05-01T00:00:00Z"},
        {"id": 2, "title": "Y", "location": {"name": "NYC"}, "absolute_url": "u",
         "updated_at": "2026-05-01T00:00:00Z"},
    ]}
    a, b = greenhouse.parse(payload, "Co")
    assert a.posted_at == "2026-01-01T00:00:00Z"
    assert b.posted_at is None  # an edit time would falsely look "new"


def test_missing_location_is_empty_string():
    payload = {"jobs": [{"id": 2, "title": " Intern ", "location": None, "absolute_url": "u"}]}
    job = greenhouse.parse(payload, "Co")[0]
    assert job.location == "" and job.title == "Intern"


def test_fetch_uses_board_token():
    session = FakeSession({URL: FakeResponse(200, fixture_json("greenhouse_stripe.json"))})
    jobs = greenhouse.fetch(STRIPE, session)
    assert len(jobs) == 6
    assert session.calls[0][1] == URL


def test_bad_token_raises_fetch_error():
    with pytest.raises(FetchError, match="404"):
        greenhouse.fetch(STRIPE, FakeSession())


def test_unexpected_shape_raises():
    with pytest.raises(FetchError):
        greenhouse.parse({"status": 404}, "Stripe")
