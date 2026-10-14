import json
from datetime import date, datetime, timezone
from pathlib import Path
from lockin_worker import leetcode
from lockin_worker.bank import load_bank, load_topics
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

FX = Path(__file__).parent / "fixtures"

class GqlSession:
    def __init__(self, *bodies):
        self.bodies = list(bodies); self.posts = []
    def post(self, url, json=None, headers=None, timeout=None):
        self.posts.append(json)
        body = self.bodies.pop(0)
        class R:
            status_code = 200
            def json(self_): return body
        return R()

def fx(name): return json.loads((FX / name).read_text())

def test_fetch_recent_parses():
    s = GqlSession(fx("lc_recent.json"))
    out = leetcode.fetch_recent(s, "adamkuhn")
    assert out[0] == {"slug": "daily-temperatures", "title": "Daily Temperatures",
                      "accepted_at": datetime.fromtimestamp(1791933317, tz=timezone.utc).isoformat()}
    assert s.posts[0]["variables"] == {"u": "adamkuhn"}

def test_fetch_tag_counts_flattens():
    s = GqlSession(fx("lc_tags.json"))
    assert leetcode.fetch_tag_counts(s, "adamkuhn") == {"union-find": 3, "hash-table": 8, "array": 20}

def test_store_solves_dedupes():
    db = MemoryDB()
    rows = [{"slug": "two-sum", "title": "Two Sum", "accepted_at": "2026-10-14T13:00:00+00:00"}]
    assert leetcode.store_solves(db, rows) == 1
    assert leetcode.store_solves(db, rows) == 0
    assert len(db.select("lc_solves")) == 1

def test_store_solves_dedupes_within_batch():
    db = MemoryDB()
    row = {"slug": "two-sum", "title": "Two Sum", "accepted_at": "2026-10-14T13:00:00+00:00"}
    assert leetcode.store_solves(db, [row, dict(row)]) == 1
    assert len(db.select("lc_solves")) == 1

def test_fetch_tag_counts_null_safe():
    s = GqlSession({"data": {"matchedUser": {"tagProblemCounts": None}}})
    assert leetcode.fetch_tag_counts(s, "adamkuhn") == {}
    s = GqlSession({"data": {"matchedUser": {"username": "adamkuhn"}}})
    assert leetcode.fetch_tag_counts(s, "adamkuhn") == {}

def _solve(db, slug, ts, rating=None):
    db.insert("lc_solves", [{"slug": slug, "title": slug, "accepted_at": ts, "rating": rating}])

def test_apply_pending_rated_today():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-14T14:00:00+00:00", "nailed")
    n = leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ))
    assert n == 1
    st = db.select("lc_problem_state")[0]
    assert (st["slug"], st["state"], st["interval_days"], st["due_on"]) == ("two-sum", "reviewing", 3, "2026-10-17")
    s = db.select("lc_solves")[0]
    assert s["effective_rating"] == "nailed" and s["interval_before"] == 0 and s["applied_at"]

def test_apply_pending_unrated_waits_until_next_day():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-14T14:00:00+00:00")
    assert leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ)) == 0
    assert leetcode.apply_pending(db, bank, date(2026, 10, 15), datetime(2026, 10, 15, 12, tzinfo=TZ)) == 1
    assert db.select("lc_solves")[0]["effective_rating"] == "struggled"

def test_apply_pending_same_day_twice():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-14T14:00:00+00:00", "help")
    _solve(db, "two-sum", "2026-10-14T15:00:00+00:00", "nailed")
    leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 23, tzinfo=TZ))
    st = db.select("lc_problem_state")[0]
    assert (st["state"], st["lapses"]) == ("learning", 1)
    second = [s for s in db.select("lc_solves") if s["accepted_at"].startswith("2026-10-14T15")][0]
    assert second["applied_at"] and second.get("effective_rating") is None

def test_apply_pending_same_day_unrated_first_then_rated():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-14T14:00:00+00:00")
    _solve(db, "two-sum", "2026-10-14T15:00:00+00:00", "nailed")
    n = leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 23, tzinfo=TZ))
    assert n == 1
    assert db.select("lc_problem_state")[0]["state"] == "reviewing"
    rows = sorted(db.select("lc_solves"), key=lambda r: r["accepted_at"])
    assert rows[0]["effective_rating"] == "nailed" and rows[0]["applied_at"]
    assert rows[1]["applied_at"] and rows[1].get("effective_rating") is None

def test_apply_pending_non_bank():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "fizz-buzz-not-in-bank", "2026-10-13T14:00:00+00:00")
    leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ))
    assert db.select("lc_problem_state") == []
    assert db.select("lc_solves")[0]["applied_at"]

def test_apply_pending_takes_slot_from_daily_set():
    db, bank = MemoryDB(), load_bank()
    db.insert("lc_daily_sets", [{"day": "2026-10-14", "focus": "Stack", "mixed_day": False,
                                 "items": [{"slug": "daily-temperatures", "slot": "mystery", "order": 0, "done": False}]}])
    _solve(db, "daily-temperatures", "2026-10-14T14:00:00+00:00", "nailed")
    leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ))
    assert db.select("lc_solves")[0]["slot"] == "mystery"

def test_recompute_levels_writes_all_topics():
    db, bank = MemoryDB(), load_bank()
    levels = leetcode.recompute_levels(db, bank, load_topics(), date(2026, 10, 14))
    assert levels["Arrays & Hashing"] == "available"
    assert levels["Trees"] == "locked"
    assert len(db.select("lc_topic_state")) == 18


def test_apply_pending_slot_uses_plan_day_after_midnight():
    db, bank = MemoryDB(), load_bank()
    db.insert("lc_daily_sets", [{"day": "2026-10-14", "items": [{"slug": "two-sum", "slot": "review"}]}])
    _solve(db, "two-sum", "2026-10-15T06:00:00+00:00", "nailed")  # 02:00 ET Oct 15 -> plan day Oct 14
    assert leetcode.apply_pending(db, bank, date(2026, 10, 15), datetime(2026, 10, 15, 12, tzinfo=TZ)) == 1
    assert db.select("lc_solves")[0]["slot"] == "review"


class RecordingDB(MemoryDB):
    def __init__(self):
        super().__init__()
        self.updates, self.upserts, self.inserts = [], [], []
    def update(self, table, eq, values):
        self.updates.append((table, dict(eq), dict(values)))
        super().update(table, eq, values)
    def upsert(self, table, rows, on_conflict, *, ignore_duplicates=False):
        self.upserts.append((table, on_conflict, ignore_duplicates, len(rows)))
        super().upsert(table, rows, on_conflict, ignore_duplicates=ignore_duplicates)
    def insert(self, table, rows):
        self.inserts.append(table)
        super().insert(table, rows)

def test_apply_pending_updates_by_id_when_present():
    db, bank = RecordingDB(), load_bank()
    db.tables["lc_solves"] = [{"id": 41, "slug": "two-sum", "title": "t", "accepted_at": "2026-10-13T14:00:00+00:00",
                               "rating": "nailed"},
                              {"id": 42, "slug": "two-sum", "title": "t", "accepted_at": "2026-10-13T15:00:00+00:00",
                               "rating": None},
                              {"id": 43, "slug": "not-in-bank-xyz", "title": "t", "accepted_at": "2026-10-13T15:00:00+00:00"}]
    assert leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ)) == 1
    eqs = [eq for t, eq, _ in db.updates if t == "lc_solves"]
    assert sorted(e["id"] for e in eqs) == [41, 42, 43] and all(set(e) == {"id"} for e in eqs)
    first = next(v for t, eq, v in db.updates if eq == {"id": 41})
    assert first["effective_rating"] == "nailed"

def test_store_solves_upserts_ignoring_duplicates():
    db = RecordingDB()
    rows = [{"slug": "two-sum", "title": "Two Sum", "accepted_at": "2026-10-14T13:00:00+00:00"}]
    assert leetcode.store_solves(db, rows) == 1
    assert db.upserts == [("lc_solves", "slug,accepted_at", True, 1)] and db.inserts == []
    assert db.select("lc_solves")[0]["rating"] is None


def test_apply_pending_groups_by_plan_day_across_midnight():
    # I2: 23:00 ET Oct 14 and 01:30 ET Oct 15 are the same plan day -> one attempt.
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-15T03:00:00+00:00", "nailed")  # 23:00 EDT Oct 14
    _solve(db, "two-sum", "2026-10-15T05:30:00+00:00", "nailed")  # 01:30 EDT Oct 15
    n = leetcode.apply_pending(db, bank, date(2026, 10, 15), datetime(2026, 10, 15, 12, tzinfo=TZ))
    assert n == 1
    rated = [s for s in db.select("lc_solves") if s.get("effective_rating")]
    assert len(rated) == 1 and rated[0]["accepted_at"].startswith("2026-10-15T03")
    assert all(s["applied_at"] for s in db.select("lc_solves"))
    assert db.select("lc_problem_state")[0]["interval_days"] == 3  # applied once, not twice


def test_apply_pending_done_key_is_plan_day():
    # An attempt applied for plan day Oct 14 blocks a 01:30 solve the next calendar day.
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-15T03:00:00+00:00", "nailed")
    leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 23, 30, tzinfo=TZ))
    _solve(db, "two-sum", "2026-10-15T05:30:00+00:00", "nailed")
    assert leetcode.apply_pending(db, bank, date(2026, 10, 15), datetime(2026, 10, 15, 12, tzinfo=TZ)) == 0
    assert len([s for s in db.select("lc_solves") if s.get("effective_rating")]) == 1
