from datetime import date, datetime
from lockin_worker import projects
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

class S:
    def __init__(self, body, status=200): self.body, self.status, self.calls = body, status, []
    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append((url, params, headers))
        body, status = self.body, self.status
        class R:
            status_code = status
            text = "x"
            def json(self_): return body
        return R()

GH = [{"sha": "abc", "commit": {"message": "Add Chicago\n\nbody", "author": {"date": "2026-10-14T18:00:00Z"}}}]

def test_fetch_commits():
    s = S(GH)
    out = projects.fetch_commits(s, "adamkuhn1/27b", "2026-10-01T00:00:00+00:00", "tok")
    assert out == [{"sha": "abc", "message": "Add Chicago", "committed_at": "2026-10-14T18:00:00Z"}]
    url, params, headers = s.calls[0]
    assert url == "https://api.github.com/repos/adamkuhn1/27b/commits"
    assert params["since"] == "2026-10-01T00:00:00+00:00" and headers["Authorization"] == "Bearer tok"

def _db():
    db = MemoryDB()
    db.insert("projects", [{"id": "27b", "name": "27B", "repo": "adamkuhn1/27b", "active": True},
                           {"id": "showboat", "name": "Showboat", "repo": "adamkuhn1/showboat", "active": True}])
    return db

def test_sync_stores_commits_per_project(monkeypatch):
    db = _db()
    monkeypatch.setattr(projects, "fetch_commits", lambda s, repo, since, tok: [
        {"sha": repo[-3:], "message": "m", "committed_at": "2026-10-14T18:00:00Z"}])
    assert projects.sync(db, None, "tok", datetime(2026, 10, 14, 20, tzinfo=TZ)) == {"commits": 2}
    assert {c["project_id"] for c in db.select("commits")} == {"27b", "showboat"}

def test_pick_today_idea_rotates_to_stalest_project():
    db = _db()
    db.insert("commits", [{"sha": "1", "project_id": "27b", "message": "m", "committed_at": "2026-10-13T12:00:00Z"}])
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "todo", "position": 0},
                        {"id": "i2", "project_id": "showboat", "text": "b", "status": "todo", "position": 0}])
    idea = projects.pick_today_idea(db, date(2026, 10, 14))
    assert idea["id"] == "i2"  # showboat has no commits → stalest
    assert db.select("ideas", {"id": "i2"})[0]["status"] == "today"

def test_pick_today_idea_resets_stale_today():
    db = _db()
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "today", "today_on": "2026-10-13", "position": 0}])
    projects.pick_today_idea(db, date(2026, 10, 14))
    row = db.select("ideas", {"id": "i1"})[0]
    assert row["status"] == "today" and row["today_on"] == "2026-10-14"

def test_pick_today_idea_none_when_no_ideas():
    assert projects.pick_today_idea(_db(), date(2026, 10, 14)) is None

def test_commit_completes_today_idea():
    db = _db()
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "today", "today_on": "2026-10-14", "position": 0}])
    db.insert("commits", [{"sha": "1", "project_id": "27b", "message": "m", "committed_at": "2026-10-14T23:30:00Z"}])
    assert projects.complete_idea_on_commit(db, date(2026, 10, 14), datetime(2026, 10, 14, 20, tzinfo=TZ))
    assert db.select("ideas", {"id": "i1"})[0]["status"] == "done"

def test_fetch_commits_empty_message_gets_placeholder():
    s = S([{"sha": "e1", "commit": {"message": "", "author": {"date": "2026-10-14T18:00:00Z"}}}])
    out = projects.fetch_commits(s, "adamkuhn1/27b", "2026-10-01T00:00:00+00:00", None)
    assert out[0]["message"] == "(no message)"

def test_sync_continues_past_failing_repo(monkeypatch):
    db = _db()
    def fake(s, repo, since, tok):
        if repo == "adamkuhn1/27b":
            raise projects.GitHubError("adamkuhn1/27b: HTTP 404 Not Found")
        return [{"sha": "s1", "message": "m", "committed_at": "2026-10-14T18:00:00Z"}]
    monkeypatch.setattr(projects, "fetch_commits", fake)
    out = projects.sync(db, None, "tok", datetime(2026, 10, 14, 20, tzinfo=TZ))
    assert out == {"commits": 1, "errors": {"adamkuhn1/27b": "adamkuhn1/27b: HTTP 404 Not Found"}}
    assert [c["project_id"] for c in db.select("commits")] == ["showboat"]

def test_sync_network_error_is_isolated(monkeypatch):
    import requests
    db = _db()
    def fake(s, repo, since, tok):
        if repo == "adamkuhn1/27b":
            raise requests.ConnectionError("boom")
        return []
    monkeypatch.setattr(projects, "fetch_commits", fake)
    out = projects.sync(db, None, "tok", datetime(2026, 10, 14, 20, tzinfo=TZ))
    assert out["commits"] == 0 and "boom" in out["errors"]["adamkuhn1/27b"]

def test_sync_raises_when_every_repo_fails(monkeypatch):
    import pytest
    db = _db()
    def fake(s, repo, since, tok):
        raise projects.GitHubError(f"{repo}: HTTP 409 empty")
    monkeypatch.setattr(projects, "fetch_commits", fake)
    with pytest.raises(projects.GitHubError) as exc:
        projects.sync(db, None, "tok", datetime(2026, 10, 14, 20, tzinfo=TZ))
    assert "adamkuhn1/27b: HTTP 409 empty" in str(exc.value)
    assert "adamkuhn1/showboat: HTTP 409 empty" in str(exc.value)
