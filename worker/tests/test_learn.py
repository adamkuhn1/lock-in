import io
import json

import pytest

from lockin_worker import cli, launcher, learn, prompts
from lockin_worker.db import MemoryDB

RID = "33333333-3333-3333-3333-333333333333"


def content(tmp_path, **over):
    module = {"id": "cs-1", "ord": 1, "title": "How computers work", "summary": "Build a computer from NAND gates.", "items": [
        {"id": "cs-1-w1", "type": "watch", "title": "Ben Eater 8-bit", "url": "https://eater.net/8bit", "hours": 12, "details": "Videos 1-10"},
        {"id": "cs-1-d1", "type": "do", "title": "nand2tetris 1-3", "url": None, "hours": 8, "details": "Gates, ALU, RAM"},
        {"id": "cs-1-b1", "type": "build", "title": "Tiny VM", "url": None, "hours": 10, "project": "Lock In", "details": "A stack VM"},
        {"id": "cs-1-c1", "type": "check", "title": "Check", "url": None, "hours": 0.5, "check": "quiz", "details": ""},
    ]}
    module.update(over)
    p = tmp_path / "learning.json"
    p.write_text(json.dumps({"tracks": [{"id": "cs", "title": "CS", "modules": [module]}]}))
    return p


def test_sync_content_upserts_once_per_change_and_drops_removed_items(tmp_path):
    db = MemoryDB()
    p = content(tmp_path)
    assert learn.sync_content(db, p) == {"modules": 1, "items": 4, "removed": 0}
    assert learn.sync_content(db, p) == {"unchanged": 1}
    data = json.loads(p.read_text())
    data["tracks"][0]["modules"][0]["items"] = [i for i in data["tracks"][0]["modules"][0]["items"] if i["id"] != "cs-1-d1"] + [
        {"id": "cs-1-d2", "type": "do", "title": "New", "url": None, "hours": 1}]
    p.write_text(json.dumps(data))
    assert learn.sync_content(db, p)["removed"] == 1
    assert sorted(i["id"] for i in db.select("learn_items")) == ["cs-1-b1", "cs-1-c1", "cs-1-d2", "cs-1-w1"]
    assert db.select("learn_items", {"id": "cs-1-b1"})[0]["project"] == "Lock In"


@pytest.mark.parametrize("items, msg", [
    ([{"id": "x", "type": "watch", "title": "t", "url": "http://insecure", "hours": 1}], "https"),
    ([{"id": "x", "type": "read", "title": "t", "url": None, "hours": 1}], "type must be"),
    ([{"id": "x", "type": "check", "title": "t", "url": None, "hours": 1}], "check items need"),
    ([{"id": "x", "type": "watch", "title": "t", "url": None, "hours": 1}], "missing"),
])
def test_content_is_validated(tmp_path, items, msg):
    with pytest.raises(learn.ContentError, match=msg):
        learn.load(content(tmp_path, items=items))


def test_repo_content_loads_when_present():
    if learn.CONTENT.exists():
        modules, items = learn.load()
        assert {m["track"] for m in modules} == {"cs", "math", "founder"}
        assert all(i["url"] is None or i["url"].startswith("https://") for i in items)


def db_with(tmp_path, kind="check_module"):
    db = MemoryDB()
    learn.sync_content(db, content(tmp_path))
    db.insert("launch_requests", [{"id": RID, "kind": kind, "status": "launched", "payload": {"module_id": "cs-1"}}])
    return db


def run(db, argv, stdin=""):
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(argv, stdin=io.StringIO(stdin), stdout=out, stderr=err, db_factory=lambda: db)
    return code, out.getvalue(), err.getvalue()


def test_save_check_records_the_quiz_and_marks_check_items_done(tmp_path):
    db = db_with(tmp_path)
    code, out, _ = run(db, ["save-check", "--request", RID], json.dumps({"score": 4, "total": 6, "summary": "Solid on gates."}))
    assert code == 0 and out.strip() == "Saved check: 4/6, struggled"  # rating from the score
    [c] = db.select("learn_checks")
    assert (c["module_id"], c["kind"], c["rating"]) == ("cs-1", "check", "struggled")
    [p] = db.select("learn_progress")
    assert (p["item_id"], p["status"], p["rating"]) == ("cs-1-c1", "done", "struggled") and p["done_on"]


def test_save_check_review_kind_and_explicit_rating(tmp_path):
    db = db_with(tmp_path, kind="review_module")
    code, out, _ = run(db, ["save-check", "--request", RID], json.dumps({"score": 3, "total": 3, "rating": "nailed", "summary": "All good."}))
    assert code == 0 and out.strip() == "Saved review: 3/3, nailed"
    assert db.select("learn_progress") == []  # a review doesn't touch items


@pytest.mark.parametrize("payload, msg", [
    ({"score": 7, "total": 6, "summary": "x"}, "score"),
    ({"score": 2, "total": 6}, "summary: required"),
    ({"score": 2, "total": 6, "summary": "x", "rating": "great"}, "rating"),
])
def test_save_check_rejects_bad_input(tmp_path, payload, msg):
    code, _, err = run(db_with(tmp_path), ["save-check", "--request", RID], json.dumps(payload))
    assert code == 2 and msg in err


def test_save_item_status_rating_and_appended_notes(tmp_path):
    db = db_with(tmp_path)
    assert run(db, ["save-item", "--item", "cs-1-w1", "--status", "in_progress", "--note", "watched 1-4"])[0] == 0
    code, out, _ = run(db, ["save-item", "--item", "cs-1-w1", "--status", "done", "--rating", "nailed", "--note", "clock   cycles clicked"])
    assert code == 0 and out.strip() == "Saved cs-1-w1: done, nailed"
    [p] = db.select("learn_progress")
    assert p["status"] == "done" and p["started_on"] and p["done_on"]
    assert p["notes"].splitlines()[0].endswith(": watched 1-4") and p["notes"].endswith(": clock cycles clicked")
    assert run(db, ["save-item", "--item", "nope", "--status", "done"])[0] == 2
    assert run(db, ["save-item", "--item", "cs-1-w1"])[0] == 2


def test_prompt_placeholders():
    assert prompts.placeholders(prompts.load("teach_item")) == {
        "track", "module_ord", "module_title", "module_summary", "item_title", "item_type", "item_hours", "item_url",
        "item_details", "item_status", "item_rating", "item_notes", "module_items", "who", "work_dir", "item_id", "lockin"}
    assert prompts.placeholders(prompts.load("check_module")) == {
        "track", "module_ord", "module_title", "module_summary", "module_items", "who", "request_id", "lockin"}
    assert "history" in prompts.placeholders(prompts.load("review_module"))


def test_build_teach_opens_build_items_in_the_project_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "LEARN_DIR", tmp_path / "learn")
    db = db_with(tmp_path)
    proj = tmp_path / "lock-in"
    proj.mkdir()
    db.insert("projects", [{"id": "lockin", "name": "Lock In", "local_path": str(proj)}])
    cwd, text = launcher.build_teach(db, {"item_id": "cs-1-b1"}, "lockin")
    assert cwd == proj and "Socratic: he attempts first" in text and "save-item --item cs-1-b1" in text
    cwd, text = launcher.build_teach(db, {"item_id": "cs-1-w1"}, "lockin")
    assert cwd == tmp_path / "learn" / "cs-1-w1" and "https://eater.net/8bit" in text
    with pytest.raises(launcher.LaunchError):
        launcher.build_teach(db, {"item_id": "missing"}, "lockin")


def test_build_check_and_review_prompts(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "LEARN_DIR", tmp_path / "learn")
    db = db_with(tmp_path)
    run(db, ["save-item", "--item", "cs-1-w1", "--status", "done", "--rating", "struggled"])
    db.insert("learn_checks", [{"id": "c", "module_id": "cs-1", "kind": "check", "score": 3, "total": 6, "rating": "struggled",
                                "summary": "Shaky on RAM.", "taken_on": "2026-10-01"}])
    _, check = launcher.build_check(db, {"module_id": "cs-1", "request_id": RID}, "lockin")
    assert "five multiple-choice questions" in check and f"save-check --request {RID}" in check
    assert "- [watch] Ben Eater 8-bit: done, struggled. Videos 1-10" in check
    _, review = launcher.build_review(db, {"module_id": "cs-1", "request_id": RID}, "lockin")
    assert "three questions" in review and "2026-10-01 check: 3/6, struggled. Shaky on RAM." in review


def test_rating_for():
    assert [learn.rating_for(s, 6) for s in (6, 5, 4, 3, 2)] == ["nailed", "nailed", "struggled", "struggled", "help"]
