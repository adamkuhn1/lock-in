from datetime import datetime

from job_radar import posted
from job_radar.models import Job

from .conftest import FakeResponse, FakeSession

ET = posted.ET
NOW = datetime(2026, 10, 7, 12, 6, tzinfo=ET)


def job(url="https://x", posted_at=None, age=None):
    return Job("Co", "SWE New Grad", "NYC", url, posted_at, "1", age)


def test_line_recent():
    j = job(posted_at="2026-10-07T15:52:00+00:00")  # 11:52 ET
    assert posted.posted_line(j, NOW) == "Posted Oct 7, 11:52 AM ET (14 min ago)"


def test_line_hours_and_utc_z():
    j = job(posted_at="2026-10-07T03:00:00Z")
    assert posted.posted_line(j, NOW) == "Posted Oct 6, 11:00 PM ET (13 hr ago)"


def test_line_flags_old_posting():
    j = job(posted_at="2026-09-03T13:32:53-04:00")
    line = posted.posted_line(j, NOW)
    assert line.startswith("⚠️ Posted Sep 3, 1:32 PM ET (33 days ago)")
    assert "older posting" in line


def test_line_simplify_age_fallback():
    assert posted.posted_line(job(age="0d"), NOW) == \
        "Added to SimplifyJobs list today (exact post time not published)"
    assert "3 days ago" in posted.posted_line(job(age="3d"), NOW)
    assert "1 month ago" in posted.posted_line(job(age="1mo"), NOW)


def test_line_nothing_known():
    assert posted.posted_line(job(), NOW) == "Post time not published by this board"


def test_resolve_greenhouse():
    s = FakeSession({"https://boards-api.greenhouse.io/v1/boards/acme/jobs/42":
                     FakeResponse(200, {"id": 42, "first_published": "2026-10-07T11:00:00-04:00"})})
    j = posted.resolve(job("https://job-boards.greenhouse.io/acme/jobs/42"), s, {})
    assert j.posted_at == "2026-10-07T11:00:00-04:00"


def test_resolve_greenhouse_gh_jid_form():
    s = FakeSession({"https://boards-api.greenhouse.io/v1/boards/acme/jobs/42":
                     FakeResponse(200, {"first_published": "2026-10-07T11:00:00-04:00"})})
    j = posted.resolve(job("https://boards.greenhouse.io/acme?gh_jid=42"), s, {})
    assert j.posted_at


def test_resolve_lever():
    uid = "6ed76ce8-4156-4b60-b120-403538bd66cd"
    s = FakeSession({f"https://api.lever.co/v0/postings/palantir/{uid}?mode=json":
                     FakeResponse(200, {"id": uid, "createdAt": 1786469891368})})
    j = posted.resolve(job(f"https://jobs.lever.co/palantir/{uid}"), s, {})
    assert j.posted_at.startswith("2026-08-11T")


def test_resolve_ashby_fetches_board_once():
    a, b = "f9985943-da11-4cbd-9c44-d2f7e421f65e", "0623a9e9-d7bb-4ee5-8100-51c68df81133"
    s = FakeSession({"https://api.ashbyhq.com/posting-api/job-board/whoop": FakeResponse(200, {"jobs": [
        {"id": a, "publishedAt": "2026-10-07T14:00:00.000+00:00"},
        {"id": b, "publishedAt": "2026-10-06T14:00:00.000+00:00"}]})})
    cache = {}
    ja = posted.resolve(job(f"https://jobs.ashbyhq.com/whoop/{a}"), s, cache)
    jb = posted.resolve(job(f"https://jobs.ashbyhq.com/whoop/{b}"), s, cache)
    assert ja.posted_at.startswith("2026-10-07") and jb.posted_at.startswith("2026-10-06")
    assert len(s.calls) == 1


def test_resolve_failure_and_unsupported_keep_job():
    j = job("https://job-boards.greenhouse.io/acme/jobs/42", age="0d")
    assert posted.resolve(j, FakeSession(), {}, log=lambda *_: None) == j  # 404 → unchanged
    w = job("https://acme.wd1.myworkdayjobs.com/x/job/y", age="0d")
    s = FakeSession()
    assert posted.resolve(w, s, {}) == w and s.calls == []


def test_resolve_skips_when_already_known():
    j = job("https://job-boards.greenhouse.io/acme/jobs/42", posted_at="2026-10-07T11:00:00Z")
    s = FakeSession()
    assert posted.resolve(j, s, {}) is j and s.calls == []
