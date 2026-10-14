from lockin_worker.db import MemoryDB
from lockin_worker.seed import seed

def test_seed_populates_reference_and_defaults():
    db = MemoryDB()
    out = seed(db, "topic-x", "sheet-1")
    assert out == {"problems": 420, "topics": 18, "projects": 2}
    assert db.select("problems", {"slug": "two-sum"})[0]["difficulty"] == "Easy"
    assert sorted(db.select("topics", {"name": "Trees"})[0]["prereqs"]) == ["Binary Search", "Linked List"]
    s = db.select("settings")[0]
    assert s["ntfy_topic"] == "topic-x" and s["sheet_id"] == "sheet-1"
    assert {p["id"] for p in db.select("projects")} == {"27b", "showboat"}

def test_seed_is_rerunnable():
    db = MemoryDB()
    seed(db, "t", "s")
    seed(db, "t", "s")
    assert len(db.select("settings")) == 1 and len(db.select("projects")) == 2

def test_seed_rerun_without_settings_keeps_existing_values():
    db = MemoryDB()
    seed(db, "t", "s")
    seed(db, None, None)
    s = db.select("settings")
    assert len(s) == 1 and s[0]["ntfy_topic"] == "t" and s[0]["sheet_id"] == "s"
