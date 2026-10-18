import pytest

from job_radar.fetchers import smartrecruiters
from job_radar.models import FetchError


def test_parse():
    payload = {"content": [{"id": "744", "name": " Software Engineer Intern (Winter 2027) ", "releasedDate": "2026-10-17T22:17:38.427Z",
                            "location": {"city": "Santa Clara", "region": "CA", "country": "us", "fullLocation": "Santa Clara, CA, United States"}}]}
    [j] = smartrecruiters.parse(payload, "ServiceNow", "ServiceNow")
    assert j.title == "Software Engineer Intern (Winter 2027)" and j.id == "744"
    assert j.url == "https://jobs.smartrecruiters.com/ServiceNow/744"
    assert j.location == "Santa Clara, CA, United States" and j.places == ("Santa Clara, CA", "US")
    assert j.posted_at == "2026-10-17T22:17:38.427Z"
    with pytest.raises(FetchError):
        smartrecruiters.parse({"x": 1}, "a", "b")
