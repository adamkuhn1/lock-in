from lockin_worker.db import MemoryDB
from lockin_worker.seed import seed

def test_seed_populates_reference_and_defaults():
    db = MemoryDB()
    out = seed(db, "topic-x", "sheet-1")
    assert out == {"problems": 420, "topics": 18, "projects": 3, "prep_items": 30}
    assert db.select("problems", {"slug": "two-sum"})[0]["difficulty"] == "Easy"
    assert sorted(db.select("topics", {"name": "Trees"})[0]["prereqs"]) == ["Binary Search", "Linked List"]
    s = db.select("settings")[0]
    assert s["ntfy_topic"] == "topic-x" and s["sheet_id"] == "sheet-1"
    assert {p["id"] for p in db.select("projects")} == {"27b", "showboat", "lego"}
    lego = db.select("projects", {"id": "lego"})[0]
    assert lego["repo"] is None and lego["local_path"] == "~/Developer/lego" and lego["active"] is True
    items = db.select("prep_items")
    assert len(items) == 30 and {i["track"] for i in items} == {"system_design", "cs"}

def test_seed_is_rerunnable():
    db = MemoryDB()
    seed(db, "t", "s")
    seed(db, "t", "s")
    assert len(db.select("settings")) == 1 and len(db.select("projects")) == 3 and len(db.select("prep_items")) == 30

def test_seed_never_overwrites_a_linked_lego_repo():
    db = MemoryDB()
    seed(db, "t", "s")
    db.update("projects", {"id": "lego"}, {"repo": "adamkuhn1/lego"})
    seed(db, "t", "s")
    assert db.select("projects", {"id": "lego"})[0]["repo"] == "adamkuhn1/lego"

def test_seed_rerun_without_settings_keeps_existing_values():
    db = MemoryDB()
    seed(db, "t", "s")
    seed(db, None, None)
    s = db.select("settings")
    assert len(s) == 1 and s[0]["ntfy_topic"] == "t" and s[0]["sheet_id"] == "s"

def test_seed_never_overwrites_edited_project_repo_or_path():
    db = MemoryDB()
    seed(db, "t", "s")
    db.update("projects", {"id": "27b"}, {"repo": "adamkuhn1/twenty-seven-b", "local_path": "~/code/27b"})
    db.update("projects", {"id": "showboat"}, {"local_path": "~/code/showboat", "active": False})
    seed(db, "t", "s")
    b = db.select("projects", {"id": "27b"})[0]
    s = db.select("projects", {"id": "showboat"})[0]
    assert (b["repo"], b["local_path"]) == ("adamkuhn1/twenty-seven-b", "~/code/27b")
    assert (s["local_path"], s["active"]) == ("~/code/showboat", False)
