import re
from datetime import datetime
from pathlib import Path
from job_radar.config import Company, Filters, LocationRules
from job_radar.models import FetchError, Job
from job_radar.radar import build_sources
from lockin_worker import jobs
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

NOW = datetime(2026, 10, 14, 12, tzinfo=TZ)
FILTERS = Filters(include=re.compile("intern|new grad", re.I), exclude=re.compile("senior", re.I),
                  location=LocationRules())

def J(i, title="Software Engineer Intern", company="Stripe"):
    return Job(company, title, "New York, NY", f"https://x/{i}", None, str(i))

def sources():
    return build_sources([Company("Stripe", "greenhouse", "stripe", "A"), Company("Ramp", "ashby", "ramp", "A")], [])

def fake(board):
    def fetch(src, session, prev_sha):
        v = board[src.key]
        if isinstance(v, Exception):
            raise v
        return v, None
    return fetch

def test_first_run_seeds_silently():
    db = MemoryDB()
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake({"greenhouse:stripe": [J(1)], "ashby:ramp": []}))
    assert out["new"] == 0 and db.select("postings") == []

def test_second_run_inserts_matching_new_only():
    db = MemoryDB()
    board = {"greenhouse:stripe": [J(1)], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board["greenhouse:stripe"] = [J(1), J(2), J(3, title="Senior Engineer Intern")]
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    rows = db.select("postings")
    assert out["new"] == 1 and [r["title"] for r in rows] == ["Software Engineer Intern"]
    assert rows[0]["status"] == "new" and rows[0]["tier"] == "A"

def test_same_posting_two_sources_once():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board = {"greenhouse:stripe": [J(5)], "ashby:ramp": [J(9, company="Stripe")]}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert len(db.select("postings")) == 1

def test_source_error_reported_others_continue():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board = {"greenhouse:stripe": FetchError("HTTP 404"), "ashby:ramp": [J(7, company="Ramp")]}
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert out["errors"] == {"greenhouse:stripe": "HTTP 404"} and out["new"] == 1

def test_load_sources_from_vendored_config():
    srcs, filters = jobs.load_sources(Path(__file__).parents[1] / "config")
    assert len(srcs) > 20 and filters.include.pattern

def test_existing_posting_not_reset_to_new():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board["greenhouse:stripe"] = [J(1)]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    db.update("postings", {}, {"status": "dismissed"})
    st = db.select("worker_state")[0]["value"]
    st["sources"]["greenhouse:stripe"]["seen"].clear()
    db.update("worker_state", {"key": "jobs"}, {"value": st})
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert [r["status"] for r in db.select("postings")] == ["dismissed"]

def test_applied_posting_kept_as_is():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board["greenhouse:stripe"] = [J(1)]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    db.update("postings", {}, {"status": "applied"})
    st = db.select("worker_state")[0]["value"]
    st["sources"]["greenhouse:stripe"]["seen"].clear()
    db.update("worker_state", {"key": "jobs"}, {"value": st})
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert [r["status"] for r in db.select("postings")] == ["applied"]

def test_unsafe_url_stored_as_none():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    bad = Job("Stripe", "Software Engineer Intern", "New York, NY", "javascript:alert(1)", None, "9")
    board["greenhouse:stripe"] = [bad]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert db.select("postings")[0]["url"] is None


def test_new_company_brings_its_recent_matches_only():
    db = MemoryDB()
    recent = Job("Stripe", "Software Engineer Intern", "New York, NY", "https://x/r", "2026-10-01T00:00:00Z", "r")
    old = Job("Stripe", "New Grad Engineer", "New York, NY", "https://x/o", "2026-06-01T00:00:00Z", "o")
    unknown = J(3)
    out = jobs.collect(db, sources(), FILTERS, None, NOW,
                       fetch=fake({"greenhouse:stripe": [recent, old, unknown], "ashby:ramp": []}))
    assert out["new"] == 1 and [r["title"] for r in db.select("postings")] == ["Software Engineer Intern"]
    # all three are now seen: a later run doesn't bring the old ones back
    out = jobs.collect(db, sources(), FILTERS, None, NOW,
                       fetch=fake({"greenhouse:stripe": [recent, old, unknown], "ashby:ramp": []}))
    assert out["new"] == 0


def test_new_github_list_still_seeds_silently():
    from job_radar.config import GitHubList
    srcs = build_sources([], [GitHubList(name="List", repo="a/b")])
    row = Job("Acme", "Software Engineer Intern", "NY", "https://x/1", "2026-10-13T00:00:00Z", "1")
    db = MemoryDB()
    out = jobs.collect(db, srcs, FILTERS, None, NOW, fetch=lambda s, sess, sha: ([row], "sha1"))
    assert out["new"] == 0 and db.select("postings") == []


def test_failing_board_alerts_once_after_six_runs_then_again_after_recovery():
    db = MemoryDB()
    ok = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(ok))
    bad = {"greenhouse:stripe": FetchError("HTTP 404"), "ashby:ramp": []}
    alerts = [jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(bad))["alert"] for _ in range(8)]
    assert alerts[:5] == [[]] * 5 and alerts[5] == ["Stripe: HTTP 404"] and alerts[6:] == [[], []]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(ok))  # recovers
    again = [jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(bad))["alert"] for _ in range(6)]
    assert again[-1] == ["Stripe: HTTP 404"]


def test_same_title_in_two_cities_is_two_postings():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    sf = Job("Stripe", "Software Engineer Intern", "San Francisco, CA", "https://x/sf", None, "sf")
    board["greenhouse:stripe"] = [J(1), sf]
    assert jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))["new"] == 2


def test_list_rows_for_companies_with_their_own_board_are_skipped():
    from job_radar.config import GitHubList
    srcs = build_sources([Company("Stripe", "greenhouse", "stripe", "A")], [GitHubList(name="List", repo="a/b")])
    board = {"greenhouse:stripe": [], "github:a/b": []}
    fetch = lambda s, sess, sha: (board[s.key], None)
    db = MemoryDB()
    jobs.collect(db, srcs, FILTERS, None, NOW, fetch=fetch)
    board["github:a/b"] = [J(1, company="Stripe"), J(2, company="Acme")]
    out = jobs.collect(db, srcs, FILTERS, None, NOW, fetch=fetch)
    assert out["new"] == 1 and [r["company"] for r in db.select("postings")] == ["Acme"]


def test_new_undated_company_brings_all_its_matches():
    srcs = build_sources([Company("Meta", "meta", "meta", "A")], [])
    db = MemoryDB()
    out = jobs.collect(db, srcs, FILTERS, None, NOW, fetch=lambda s, sess, sha: ([J(1, company="Meta")], None))
    assert out["new"] == 1
