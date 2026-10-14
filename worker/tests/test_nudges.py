from datetime import date, datetime

import pytest

from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB
from lockin_worker.nudges import Nudge, decide, health, run, send
from lockin_worker.streaks import DayStatus

TIMES = ["10:00", "18:00", "22:00"]

def S(**kw):
    base = dict(lc_done=0, lc_total=6, focus="Sliding Window", reviews=1, mixed_day=False, project_done=False,
                idea_text="Add Chicago", new_postings=9, starred_postings=2, followups_due=1, lc_streak=6, project_streak=2,
                has_projects=True, active_streak=6)
    base.update(kw)
    base.setdefault("lc_today", base["lc_done"] > 0)  # a done set item implies a solve today
    return DayStatus(**base)

def at(h, m=0): return datetime(2026, 10, 14, h, m, tzinfo=TZ)

def test_nothing_before_first_slot():
    assert decide(at(9, 40), TIMES, S(), set()) == []

def test_plan_message():
    [n] = decide(at(10, 7), TIMES, S(), set())
    assert n.kind == "plan"
    assert n.body == "Sliding Window · 6 problems (1 review) · 9 new postings (2⭐) · 1 follow-up"

def test_plan_message_mixed_day_hides_topic():
    [n] = decide(at(10, 7), TIMES, S(mixed_day=True), set())
    assert n.body.startswith("Mixed day · 6 problems")

def test_nudge_not_resent_same_day():
    assert decide(at(10, 37), TIMES, S(), {"plan"}) == []

def test_evening_only_if_something_open():
    [n] = decide(at(18, 7), TIMES, S(lc_done=2, followups_due=0), {"plan"})
    assert (n.kind, n.body) == ("check", "Still open: LeetCode 2/6 · project")
    assert decide(at(18, 7), TIMES, S(lc_done=6, project_done=True, followups_due=0), {"plan"}) == []

def test_risk_uses_any_work_streak():
    st = S(active_streak=5, active_today=False, lc_streak=0, project_streak=0)
    out = decide(at(22, 7), TIMES, st, {"plan", "check"})
    assert len(out) == 1 and out[0].kind == "risk" and out[0].priority == "high"
    assert out[0].body == "Lock-in streak (5 days) ends at 4 AM. One solve, app, email, commit or prep keeps it."
    assert decide(at(22, 7), TIMES, S(active_streak=5, active_today=True), {"plan", "check"}) == []
    assert decide(at(22, 7), TIMES, S(active_streak=0, active_today=False), {"plan", "check"}) == []


def test_plan_nudge_appends_agenda():
    out = decide(at(10, 7), TIMES, S(agenda=("Stripe OA today", "Figma interview tomorrow")), set())
    assert out[0].body.endswith(" · Stripe OA today · Figma interview tomorrow")


def test_late_run_sends_only_latest_due_slot():
    kinds = [n.kind for n in decide(at(22, 30), TIMES, S(), set())]
    assert kinds == ["risk"]   # don't spam three nudges after an outage

def test_health_alerts_once_after_24h():
    now = at(12)
    rows = [{"source": "sheet", "consecutive_failures": 50, "failing_since": "2026-10-13T11:00:00-04:00",
             "last_error": "HTTP 403", "alerted_on": None},
            {"source": "leetcode", "consecutive_failures": 2, "failing_since": "2026-10-14T11:00:00-04:00",
             "last_error": "x", "alerted_on": None},
            {"source": "jobs", "consecutive_failures": 60, "failing_since": "2026-10-12T11:00:00-04:00",
             "last_error": "x", "alerted_on": "2026-10-14"}]
    out = health(rows, now, date(2026, 10, 14))
    assert [s for s, _ in out] == ["sheet"] and out[0][1].priority == "low"

def test_health_body_is_redacted():
    now = at(12)
    rows = [{"source": "sheet", "failing_since": "2026-10-13T11:00:00-04:00",
             "last_error": "GET https://secret.example/x?token=abc123 failed for a@b.com", "alerted_on": None}]
    [(_, n)] = health(rows, now, date(2026, 10, 14))
    assert n.body == "sheet sync failing since 11:00, Oct 13. Details in Lock In → Settings."
    assert n.title == "Lock In: sheet sync failing"
    for leaked in ("secret.example", "abc123", "a@b.com", "GET", "token"):
        assert leaked not in n.body

class FakeResp:
    def __init__(self, status_code=200):
        self.status_code = status_code

class FakeSession:
    def __init__(self, fail_health=False, status=200):
        self.calls = []
        self.fail_health = fail_health
        self.status = status

    def post(self, url, data, headers, timeout):
        self.calls.append((url, data, headers))
        if self.fail_health and headers["Title"].startswith("Lock In:"):
            raise OSError("network down")
        return FakeResp(self.status)

APP = "https://lockin.example/app"

def test_run_sends_plan_once_per_day():
    db = MemoryDB()
    s = FakeSession()
    now = at(10, 7)
    assert run(db, s, now, "topic", APP, TIMES) == ["plan"]
    assert run(db, s, now, "topic", APP, TIMES) == []
    assert len(s.calls) == 1
    url, data, headers = s.calls[0]
    assert headers["Click"] == APP
    assert data == b"LeetCode set not ready yet"
    [row] = db.select("worker_state", {"key": "nudges"})
    assert row["value"] == {"2026-10-14": ["plan"]}

def test_failing_health_send_keeps_plan_logged():
    db = MemoryDB()
    db.insert("sync_status", [{"source": "sheet", "failing_since": "2026-10-13T09:00:00-04:00",
                               "last_error": "boom", "alerted_on": None}])
    s = FakeSession(fail_health=True)
    assert run(db, s, at(10, 7), "topic", APP, TIMES) == ["plan"]   # health failure does not raise
    [row] = db.select("worker_state", {"key": "nudges"})
    assert "plan" in row["value"]["2026-10-14"]
    assert db.select("sync_status")[0]["alerted_on"] is None
    # next run does not re-send the plan
    s.fail_health = False
    run(db, s, at(10, 37), "topic", APP, TIMES)
    assert [h["Title"] for _, _, h in s.calls].count("Today's plan") == 1

def test_send_encodes_non_ascii_title_and_checks_status():
    import base64
    s = FakeSession()
    send(s, "my topic/x", Nudge("plan", "Café plan", "body"))
    url, _, headers = s.calls[0]
    assert url == "https://ntfy.sh/my%20topic%2Fx"
    assert headers["Title"] == "=?UTF-8?B?" + base64.b64encode("Café plan".encode()).decode() + "?="
    with pytest.raises(RuntimeError):
        send(FakeSession(status=500), "topic", Nudge("plan", "t", "b"))


def test_check_counts_solve_outside_set_as_progress_only_for_set():
    # check nudge still reports the set's progress even when a solve happened outside the set
    [n] = decide(at(18, 7), TIMES, S(lc_done=0, lc_today=True, project_done=True, followups_due=0), {"plan"})
    assert n.body == "Still open: LeetCode 0/6"

def test_no_risk_when_any_work_today_and_risk_when_none():
    assert decide(at(22, 7), TIMES, S(active_today=True), {"plan", "check"}) == []
    [n] = decide(at(22, 7), TIMES, S(active_today=False), {"plan", "check"})
    assert n.kind == "risk"

def test_check_omits_project_without_projects_or_idea():
    st = S(lc_done=6, followups_due=0, project_done=False, has_projects=False)
    assert decide(at(18, 7), TIMES, st, {"plan"}) == []
    [n] = decide(at(18, 7), TIMES, S(lc_done=6, followups_due=0, has_projects=True), {"plan"})
    assert n.body == "Still open: project"
