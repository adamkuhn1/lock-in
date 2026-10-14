import pytest
from lockin_worker.db import MemoryDB, RestDB, DBError
from tests.conftest import RecordingSession, FakeResp

def test_memory_upsert_merges_on_conflict():
    db = MemoryDB()
    db.upsert("lc_problem_state", [{"slug": "two-sum", "lapses": 0}], on_conflict="slug")
    db.upsert("lc_problem_state", [{"slug": "two-sum", "lapses": 2}], on_conflict="slug")
    assert db.select("lc_problem_state") == [{"slug": "two-sum", "lapses": 2}]

def test_memory_select_update_delete():
    db = MemoryDB()
    db.insert("ideas", [{"id": "a", "status": "todo"}, {"id": "b", "status": "done"}])
    assert [r["id"] for r in db.select("ideas", {"status": "todo"})] == ["a"]
    db.update("ideas", {"id": "a"}, {"status": "today"})
    assert db.select("ideas", {"id": "a"})[0]["status"] == "today"
    db.delete("ideas", {"status": "done"})
    assert [r["id"] for r in db.select("ideas")] == ["a"]
    db.delete("ideas")
    assert db.select("ideas") == []

def test_rest_select_adds_owner_filter():
    s = RecordingSession([FakeResp(200, [{"x": 1}])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    assert db.select("ideas", {"status": "todo"}) == [{"x": 1}]
    method, url, kw = s.calls[0]
    assert method == "GET" and url == "https://p.supabase.co/rest/v1/ideas"
    assert kw["params"] == {"select": "*", "owner": "eq.owner-1", "status": "eq.todo", "order": "id"}  # I4 adds order
    assert kw["headers"]["apikey"] == "key"

def test_rest_global_table_has_no_owner():
    s = RecordingSession([FakeResp(201, [])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    db.upsert("problems", [{"slug": "a"}], on_conflict="slug")
    _, _, kw = s.calls[0]
    assert kw["json"] == [{"slug": "a"}]
    assert kw["params"] == {"on_conflict": "slug"}
    assert "resolution=merge-duplicates" in kw["headers"]["Prefer"]

def test_rest_insert_sets_owner():
    s = RecordingSession([FakeResp(201, [])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    db.insert("ideas", [{"text": "x"}])
    assert s.calls[0][2]["json"] == [{"text": "x", "owner": "owner-1"}]

def test_rest_error_raises():
    s = RecordingSession([FakeResp(500, {"message": "boom"})])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    with pytest.raises(DBError):
        db.select("ideas")

def test_rest_bool_filter_lowercase():
    s = RecordingSession([FakeResp(200, [])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    db.select("ideas", {"active": True})
    assert s.calls[0][2]["params"]["active"] == "eq.true"

def test_memory_upsert_ignore_duplicates_keeps_existing():
    db = MemoryDB()
    db.upsert("postings", [{"id": "a", "status": "dismissed"}], on_conflict="id")
    db.upsert("postings", [{"id": "a", "status": "new"}, {"id": "b", "status": "new"}], on_conflict="id",
              ignore_duplicates=True)
    assert db.select("postings") == [{"id": "a", "status": "dismissed"}, {"id": "b", "status": "new"}]

def test_rest_upsert_ignore_duplicates_header():
    s = RecordingSession([FakeResp(201, [])])
    RestDB("https://p.supabase.co", "key", "o", session=s).upsert(
        "postings", [{"id": "a"}], on_conflict="id", ignore_duplicates=True)
    assert s.calls[0][2]["headers"]["Prefer"] == "resolution=ignore-duplicates,return=minimal"

def test_rest_select_paginates():
    full = [{"i": n} for n in range(1000)]
    s = RecordingSession([FakeResp(200, full), FakeResp(200, [{"i": 1000}])])
    rows = RestDB("https://p.supabase.co", "key", "o", session=s).select("ideas")
    assert len(s.calls) == 2 and len(rows) == 1001
    h0, h1 = s.calls[0][2]["headers"], s.calls[1][2]["headers"]
    assert h0["Range-Unit"] == "items" and h0["Range"] == "0-999" and h1["Range"] == "1000-1999"

def test_rest_select_orders_pages_by_key():
    from lockin_worker.db import ORDER
    s = RecordingSession([FakeResp(200, []), FakeResp(200, []), FakeResp(200, [])])
    db = RestDB("https://p.supabase.co", "key", "o", session=s)
    db.select("lc_solves")
    db.select("problems")
    db.select("lc_problem_state", {"state": "learning"})
    assert [c[2]["params"]["order"] for c in s.calls] == ["id", "slug", "slug"]
    assert ORDER["topics"] == "name" and ORDER["applications"] == "id"

def test_order_covers_every_table():
    import re
    from pathlib import Path
    from lockin_worker.db import ORDER
    sql = (Path(__file__).parents[2] / "supabase/migrations/0001_init.sql").read_text()
    assert set(re.findall(r"create table public\.(\w+)", sql)) == set(ORDER)

def test_rest_owned_upsert_scopes_conflict_and_rows_to_owner():
    s = RecordingSession([FakeResp(201, [])])
    RestDB("https://p.supabase.co", "key", "owner-1", session=s).upsert(
        "lc_problem_state", [{"slug": "a"}], on_conflict="slug")
    _, _, kw = s.calls[0]
    assert kw["params"] == {"on_conflict": "owner,slug"}
    assert kw["json"] == [{"slug": "a", "owner": "owner-1"}]

def test_rest_update_and_delete_filter_by_owner():
    s = RecordingSession([FakeResp(204, []), FakeResp(204, []), FakeResp(204, [])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    db.update("ideas", {"id": "x"}, {"status": "done"})
    db.delete("applications")
    db.update("settings", {}, {"lc_focus_topic": "Stack"})
    (m0, _, k0), (m1, _, k1), (m2, _, k2) = s.calls
    assert m0 == "PATCH" and k0["params"] == {"owner": "eq.owner-1", "id": "eq.x"} and k0["json"] == {"status": "done"}
    assert m1 == "DELETE" and k1["params"] == {"owner": "eq.owner-1"}
    assert m2 == "PATCH" and k2["params"] == {"owner": "eq.owner-1"}
