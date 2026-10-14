from datetime import date, datetime, timedelta
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB
from lockin_worker.streaks import day_status, streak

D = date(2026, 10, 14)

def test_streak_counts_back_from_today_or_yesterday():
    assert streak({D, D - timedelta(1), D - timedelta(2)}, D) == 3
    assert streak({D - timedelta(1), D - timedelta(2)}, D) == 2   # today not done yet: still alive
    assert streak({D - timedelta(2)}, D) == 0
    assert streak(set(), D) == 0

def test_streak_counts_late_night_solve():
    db = MemoryDB()
    db.insert("lc_solves", [{"slug": "a", "title": "a", "accepted_at": "2026-10-14T03:50:00+00:00"}])  # 23:50 ET Oct 13
    st = day_status(db, datetime(2026, 10, 14, 9, tzinfo=TZ))
    assert st.lc_streak == 1

def test_day_status_counts():
    db = MemoryDB()
    db.insert("lc_daily_sets", [{"day": "2026-10-14", "focus": "Stack", "mixed_day": False,
              "items": [{"slug": "a", "slot": "review", "order": 0, "done": True},
                        {"slug": "b", "slot": "new", "order": 1, "done": False}]}])
    f = "2026-10-13T12:00:00+00:00"
    db.insert("postings", [{"id": "1", "status": "new", "starred": True, "found_at": f},
                           {"id": "2", "status": "new", "starred": False, "found_at": f},
                           {"id": "3", "status": "seen", "starred": True, "found_at": f}])
    db.insert("outreach", [{"id": "o", "status": "sent", "follow_up_on": "2026-10-14"},
                           {"id": "p", "status": "replied", "follow_up_on": "2026-10-10"}])
    db.insert("ideas", [{"id": "i", "project_id": "27b", "text": "Add Chicago", "status": "today", "today_on": "2026-10-14"}])
    st = day_status(db, datetime(2026, 10, 14, 10, tzinfo=TZ))
    assert (st.lc_done, st.lc_total, st.focus, st.reviews) == (1, 2, "Stack", 1)
    assert (st.new_postings, st.starred_postings, st.followups_due) == (2, 1, 1)
    assert st.idea_text == "Add Chicago" and st.project_done is False


def test_lc_today_counts_any_solve_today():
    db = MemoryDB()
    db.insert("lc_daily_sets", [{"day": "2026-10-14", "focus": "Stack", "mixed_day": False,
              "items": [{"slug": "b", "slot": "new", "order": 0, "done": False}]}])
    st = day_status(db, datetime(2026, 10, 14, 21, tzinfo=TZ))
    assert st.lc_today is False
    db.insert("lc_solves", [{"slug": "off-plan", "title": "x", "accepted_at": "2026-10-14T19:00:00-04:00"}])
    st = day_status(db, datetime(2026, 10, 14, 21, tzinfo=TZ))
    assert st.lc_today is True and st.lc_done == 0 and st.lc_streak == 1

def test_has_projects_from_active_project_or_today_idea():
    now = datetime(2026, 10, 14, 10, tzinfo=TZ)
    db = MemoryDB()
    db.insert("projects", [{"id": "old", "name": "x", "repo": "a/b", "active": False}])
    assert day_status(db, now).has_projects is False
    db.insert("ideas", [{"id": "i", "text": "t", "status": "today", "today_on": "2026-10-14"}])
    assert day_status(db, now).has_projects is True
    db2 = MemoryDB()
    db2.insert("projects", [{"id": "p", "name": "x", "repo": "a/b", "active": True}])
    assert day_status(db2, now).has_projects is True


def test_day_status_new_postings_use_web_30_day_window():
    # M15: same window as the web Today card (found_at within the last 30 days).
    db = MemoryDB()
    now = datetime(2026, 10, 14, 10, tzinfo=TZ)  # 14:00Z
    db.insert("postings", [
        {"id": "fresh", "status": "new", "starred": True, "found_at": "2026-10-01T00:00:00Z"},
        {"id": "edge", "status": "new", "starred": False, "found_at": "2026-09-14T14:00:00Z"},  # exactly 30 days
        {"id": "old", "status": "new", "starred": True, "found_at": "2026-09-14T13:59:00Z"},
    ])
    st = day_status(db, now)
    assert (st.new_postings, st.starred_postings) == (2, 1)


from datetime import timezone
from lockin_worker.streaks import activity_days


def test_activity_days_unions_all_kinds_on_plan_days():
    db = MemoryDB()
    db.insert("lc_solves", [{"accepted_at": "2026-10-14T07:30:00Z"}])  # 03:30 EDT Oct 14 -> plan day Oct 13
    db.insert("commits", [{"committed_at": "2026-10-14T08:00:00Z"}])   # 04:00 EDT -> Oct 14
    db.insert("applications", [{"applied_on": "2026-10-10"}, {"applied_on": None}])
    db.insert("outreach", [{"sent_on": "2026-10-11"}, {"sent_on": None}])
    db.insert("prep_sessions", [{"happened_on": "2026-10-12"}])
    assert activity_days(db) == {date(2026, 10, d) for d in (10, 11, 12, 13, 14)}


def test_day_status_active_streak_counts_any_kind_and_today_flag():
    db = MemoryDB()
    db.insert("prep_sessions", [{"happened_on": "2026-10-12"}, {"happened_on": "2026-10-13"}])
    now = datetime(2026, 10, 14, 2, 0, tzinfo=timezone.utc)  # 22:00 EDT Oct 13 -> plan day Oct 13
    st = day_status(db, now)
    assert st.active_streak == 2 and st.active_today is True
    later = datetime(2026, 10, 15, 2, 0, tzinfo=timezone.utc)  # 22:00 EDT Oct 14, nothing yet
    st2 = day_status(db, later)
    assert st2.active_streak == 2 and st2.active_today is False


def test_day_status_idea_text_includes_in_progress_today_idea():
    db = MemoryDB()
    db.insert("ideas", [{"id": "i", "project_id": "27b", "text": "Add Chicago", "status": "in_progress",
                         "today_on": "2026-10-14"}])
    st = day_status(db, datetime(2026, 10, 14, 10, tzinfo=TZ))
    assert st.idea_text == "Add Chicago" and st.has_projects is True


def test_active_streak_ignores_activity_before_day_one():
    db = MemoryDB()
    db.insert("settings", [{"day_one": "2026-10-13"}])
    db.insert("prep_sessions", [{"happened_on": d} for d in ("2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14")])
    st = day_status(db, datetime(2026, 10, 14, 10, tzinfo=TZ))
    assert st.active_streak == 2 and st.active_today is True


def test_active_streak_defaults_day_one_when_settings_missing():
    db = MemoryDB()
    db.insert("prep_sessions", [{"happened_on": d} for d in ("2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29")])
    st = day_status(db, datetime(2026, 9, 29, 10, tzinfo=TZ))
    assert st.active_streak == 2  # default Day 1 is 2026-09-28
    db.insert("settings", [{"day_one": None}])
    assert day_status(db, datetime(2026, 9, 29, 10, tzinfo=TZ)).active_streak == 2


def test_future_day_one_means_no_streak():
    db = MemoryDB()
    db.insert("settings", [{"day_one": "2026-10-20"}])
    db.insert("prep_sessions", [{"happened_on": "2026-10-14"}])
    st = day_status(db, datetime(2026, 10, 14, 10, tzinfo=TZ))
    assert st.active_streak == 0 and st.active_today is False
