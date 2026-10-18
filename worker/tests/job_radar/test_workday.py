from datetime import datetime, timezone

import pytest

from job_radar.config import Company
from job_radar.fetchers import workday
from job_radar.models import FetchError

NOW = datetime(2026, 10, 18, 15, tzinfo=timezone.utc)


def test_parse_token():
    assert workday.parse_token("nvidia.wd5/NVIDIAExternalCareerSite") == (
        "nvidia.wd5.myworkdayjobs.com", "nvidia", "NVIDIAExternalCareerSite")
    with pytest.raises(FetchError):
        workday.parse_token("https://nvidia.wd5.myworkdayjobs.com/x")


@pytest.mark.parametrize("text,expected", [
    ("Posted Today", "2026-10-18"), ("Posted Yesterday", "2026-10-17"), ("Posted 3 Days Ago", "2026-10-15"),
    ("Posted 30+ Days Ago", None), ("", None), (None, None),
])
def test_posted_at(text, expected):
    got = workday.posted_at(text, NOW)
    assert (got[:10] if got else None) == expected


def test_parse_builds_links_and_skips_rows_without_a_path():
    payload = {"total": 2, "jobPostings": [
        {"title": " Software Engineer - New College Grad 2027 ", "externalPath": "/job/US-CA-Santa-Clara/SWE_JR1",
         "locationsText": "US, CA, Santa Clara", "postedOn": "Posted Today"},
        {"title": "No path"},
    ]}
    [j] = workday.parse(payload, "NVIDIA", "nvidia.wd5.myworkdayjobs.com", "Site", NOW)
    assert j.title == "Software Engineer - New College Grad 2027" and j.id == "/job/US-CA-Santa-Clara/SWE_JR1"
    assert j.url == "https://nvidia.wd5.myworkdayjobs.com/Site/job/US-CA-Santa-Clara/SWE_JR1"
    assert j.location == "US, CA, Santa Clara" and j.posted_at.startswith("2026-10-18")
    with pytest.raises(FetchError):
        workday.parse({"oops": 1}, "x", "h", "s", NOW)


class Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class Session:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def post(self, url, json, timeout, headers):
        self.calls.append((url, json["searchText"], json["offset"]))
        return self.pages(json)


def row(i):
    return {"title": f"Software Engineer Intern {i}", "externalPath": f"/job/x/{i}", "locationsText": "US", "postedOn": "Posted Today"}


def test_fetch_runs_each_query_dedupes_and_stops_on_a_short_page():
    def pages(body):  # every query returns the same 20 + 3 rows
        return Resp(200, {"jobPostings": [row(i) for i in range(20)] if body["offset"] == 0 else [row(20 + i) for i in range(3)]})
    s = Session(pages)
    jobs = workday.fetch(Company("NVIDIA", "workday", "nvidia.wd5/Site", "A"), s, now=NOW)
    assert len(jobs) == 23
    assert s.calls[0] == ("https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/jobs", "new grad", 0)
    assert len(s.calls) == 2 * len(workday.QUERIES)


def test_fetch_error_status_raises():
    s = Session(lambda body: Resp(429, {}))
    with pytest.raises(FetchError, match="HTTP 429"):
        workday.fetch(Company("X", "workday", "x.wd1/S", "B"), s, now=NOW)
