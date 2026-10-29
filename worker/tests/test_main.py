from datetime import datetime
import pytest
from lockin_worker import __main__ as m
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB, DBError

NOW = datetime(2026, 10, 14, 12, tzinfo=TZ)

def _db():
    db = MemoryDB()
    db.insert("settings", [{"daily_lc_count": 6}])
    return db

def test_run_isolates_source_failures():
    db = _db()
    def boom(*a): raise RuntimeError("google key expired")
    steps = [("sheet", boom), ("leetcode", lambda *a: {"new_solves": 0})]
    out = m.run(db, None, NOW, {}, steps=steps)
    assert out["ok"] == ["leetcode"] and "google key expired" in out["failed"]["sheet"]
    rows = {r["source"]: r for r in db.select("sync_status")}
    assert rows["sheet"]["consecutive_failures"] == 1 and rows["sheet"]["failing_since"]
    assert rows["leetcode"]["consecutive_failures"] == 0 and rows["leetcode"]["last_ok_at"]

def test_recovery_clears_failing_since():
    db = _db()
    def boom(*a): raise RuntimeError("x")
    m.run(db, None, NOW, {}, steps=[("sheet", boom)])
    m.run(db, None, NOW, {}, steps=[("sheet", lambda *a: {})])
    row = db.select("sync_status")[0]
    assert row["failing_since"] is None and row["consecutive_failures"] == 0

def test_run_fails_when_db_down():
    class DownDB(MemoryDB):
        def select(self, *a, **k): raise DBError("HTTP 503")
    with pytest.raises(DBError):
        m.run(DownDB(), None, NOW, {}, steps=[("leetcode", lambda *a: {})])


def test_error_secrets_redacted(capsys):
    db = _db()
    def boom(*a): raise RuntimeError("GET https://x.com/a?key=SECRET failed")
    m.run(db, None, NOW, {}, steps=[("github", boom)])
    assert "SECRET" not in db.select("sync_status")[0]["last_error"]
    assert "SECRET" not in capsys.readouterr().err
    assert len(m._safe_err(RuntimeError("x" * 1000))) <= 200 + len("RuntimeError: ")

def test_missing_settings_row_raises():
    with pytest.raises(RuntimeError, match="settings row missing"):
        m.run(MemoryDB(), None, NOW, {}, steps=[])

def test_sheet_unconfigured_is_skip():
    db = _db()
    out = m.run(db, None, NOW, {}, steps=[(n, f) for n, f in m.default_steps({}) if n == "sheet"])
    assert out == {"ok": ["sheet"], "failed": {}}
    assert m.default_steps({})[2][1](db, None, NOW) == {"skipped": "not configured"}


def _finish_db():
    db = _db()
    db.update("settings", {}, {"ntfy_topic": "t"})
    return db

def test_finish_failing_phase_still_runs_nudges(monkeypatch):
    db = _finish_db()
    calls = []
    def boom(*a): raise RuntimeError("apply exploded ?token=SECRET")
    monkeypatch.setattr(m.leetcode, "apply_pending", boom)
    monkeypatch.setattr(m.nudges, "run", lambda *a: calls.append(a) or ["plan"])
    failed = m.finish(db, None, NOW, {})
    assert calls, "nudges must run even when a finish phase fails"
    assert failed == ["plan"]
    rows = {r["source"]: r for r in db.select("sync_status")}
    assert rows["plan"]["consecutive_failures"] == 1 and "apply_pending" in rows["plan"]["last_error"]
    assert "SECRET" not in rows["plan"]["last_error"]
    assert rows["nudges"]["consecutive_failures"] == 0 and rows["nudges"]["last_ok_at"]
    # later phases still ran: the daily set exists despite apply_pending failing
    assert db.select("lc_daily_sets", {"day": "2026-10-14"})

def test_finish_ok_records_plan_and_nudges(monkeypatch):
    db = _finish_db()
    monkeypatch.setattr(m.nudges, "run", lambda *a: [])
    assert m.finish(db, None, NOW, {}) == []
    rows = {r["source"]: r for r in db.select("sync_status")}
    assert rows["plan"]["last_error"] is None and rows["nudges"]["last_error"] is None

def test_finish_nudge_failure_recorded(monkeypatch):
    db = _finish_db()
    def boom(*a): raise RuntimeError("ntfy HTTP 500")
    monkeypatch.setattr(m.nudges, "run", boom)
    assert m.finish(db, None, NOW, {}) == ["nudges"]
    rows = {r["source"]: r for r in db.select("sync_status")}
    assert "ntfy HTTP 500" in rows["nudges"]["last_error"] and rows["plan"]["last_error"] is None

def test_main_exits_1_when_finish_fails(monkeypatch):
    db = _finish_db()
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "LOCKIN_OWNER_ID"):
        monkeypatch.setenv(k, "x")
    monkeypatch.setattr(m, "RestDB", lambda *a: db)
    monkeypatch.setattr(m.clock, "now", lambda: NOW)
    monkeypatch.setattr(m, "default_steps", lambda env: [])
    monkeypatch.setattr(m.nudges, "run", lambda *a: [])
    assert m.main() == 0
    def boom(*a): raise RuntimeError("x")
    monkeypatch.setattr(m.plan, "refresh_done", boom)
    assert m.main() == 1

def test_step_output_prints_counts_only(capsys):
    db = _db()
    steps = [("jobs", lambda *a: {"new": 3, "seeded": False, "errors": {"b": "HTTP 500 https://x?k=S", "a": "y"}}),
             ("github", lambda *a: {"commits": 2, "errors": {"o/r": "token SECRET"}}),
             ("sheet", lambda *a: {"skipped": "not configured"})]
    m.run(db, None, NOW, {}, steps=steps)
    out = capsys.readouterr().out
    assert "jobs {'new': 3, 'seeded': False, 'errors': ['a', 'b']}" in out
    assert "github {'commits': 2, 'errors': ['o/r']}" in out
    assert "sheet {}" in out
    assert "SECRET" not in out and "HTTP 500" not in out


def test_only_jobs_runs_just_the_job_scan(monkeypatch):
    db = _finish_db()
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "LOCKIN_OWNER_ID"):
        monkeypatch.setenv(k, "x")
    monkeypatch.setattr(m, "RestDB", lambda *a: db)
    monkeypatch.setattr(m.clock, "now", lambda: NOW)
    ran = []
    monkeypatch.setattr(m, "default_steps", lambda env: [(n, lambda *a, n=n: ran.append(n) or {}) for n in ("leetcode", "jobs")])
    monkeypatch.setattr(m, "finish", lambda *a: (_ for _ in ()).throw(AssertionError("finish must not run")))
    assert m.main(["--only", "jobs"]) == 0
    assert ran == ["jobs"]
