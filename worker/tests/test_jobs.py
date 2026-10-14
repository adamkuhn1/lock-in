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

def test_unsafe_url_stored_as_none():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    bad = Job("Stripe", "Software Engineer Intern", "New York, NY", "javascript:alert(1)", None, "9")
    board["greenhouse:stripe"] = [bad]
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert db.select("postings")[0]["url"] is None
