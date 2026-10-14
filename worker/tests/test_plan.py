from datetime import datetime
from lockin_worker import plan
from lockin_worker.bank import load_bank, load_topics
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

def _db():
    db = MemoryDB()
    db.insert("settings", [{"daily_lc_count": 6, "lc_started_on": None, "lc_focus_topic": None, "lc_focus_since": None}])
    return db

def test_ensure_plan_creates_set_after_4am():
    db = _db()
    assert plan.ensure_plan(db, datetime(2026, 10, 14, 5, tzinfo=TZ), load_bank(), load_topics())
    [row] = db.select("lc_daily_sets")
    assert row["day"] == "2026-10-14" and len(row["items"]) == 6 and row["focus"] == "Arrays & Hashing"
    s = db.select("settings")[0]
    assert s["lc_started_on"] == "2026-10-14" and s["lc_focus_topic"] == "Arrays & Hashing"

def test_ensure_plan_is_idempotent():
    db = _db()
    now = datetime(2026, 10, 14, 5, tzinfo=TZ)
    plan.ensure_plan(db, now, load_bank(), load_topics())
    assert plan.ensure_plan(db, now, load_bank(), load_topics()) is False
    assert len(db.select("lc_daily_sets")) == 1

def test_before_4am_uses_previous_plan_day():
    db = _db()
    plan.ensure_plan(db, datetime(2026, 10, 15, 2, tzinfo=TZ), load_bank(), load_topics())
    assert db.select("lc_daily_sets")[0]["day"] == "2026-10-14"

def test_refresh_done_marks_solved_items():
    db = _db()
    now = datetime(2026, 10, 14, 5, tzinfo=TZ)
    plan.ensure_plan(db, now, load_bank(), load_topics())
    first = db.select("lc_daily_sets")[0]["items"][0]["slug"]
    db.insert("lc_solves", [{"slug": first, "title": first, "accepted_at": "2026-10-14T15:00:00+00:00"}])
    assert plan.refresh_done(db, datetime(2026, 10, 14, 12, tzinfo=TZ)) == 1
    assert db.select("lc_daily_sets")[0]["items"][0]["done"] is True
