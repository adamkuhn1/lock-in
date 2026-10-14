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


def test_commit_after_midnight_completes_plan_day_idea():
    # I2: 01:30 ET Oct 15 is still plan day Oct 14.
    db = _db()
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "today", "today_on": "2026-10-14", "position": 0}])
    db.insert("commits", [{"sha": "1", "project_id": "27b", "message": "m", "committed_at": "2026-10-15T05:30:00Z"}])
    assert projects.complete_idea_on_commit(db, date(2026, 10, 14), datetime(2026, 10, 15, 2, tzinfo=TZ))
    assert db.select("ideas", {"id": "i1"})[0]["status"] == "done"


def test_commit_before_4am_does_not_complete_next_plan_day():
    db = _db()
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "today", "today_on": "2026-10-15", "position": 0}])
    db.insert("commits", [{"sha": "1", "project_id": "27b", "message": "m", "committed_at": "2026-10-15T05:30:00Z"}])
    assert not projects.complete_idea_on_commit(db, date(2026, 10, 15), datetime(2026, 10, 15, 12, tzinfo=TZ))


from lockin_worker import projects as P
from lockin_worker.db import MemoryDB


class Sess:
    def __init__(self):
        self.urls = []

    def get(self, url, **kw):
        self.urls.append(url)

        class R:
            status_code = 200
            text = "[]"

            def json(self):
                return []
        return R()


def test_sync_skips_projects_without_repo():
    db = MemoryDB()
    db.insert("projects", [{"id": "27b", "repo": "adamkuhn1/27b", "active": True},
                           {"id": "lego", "repo": None, "active": True}])
    s = Sess()
    from datetime import datetime, timezone
    assert P.sync(db, s, None, datetime(2026, 10, 14, tzinfo=timezone.utc)) == {"commits": 0}
    assert len(s.urls) == 1 and "adamkuhn1/27b" in s.urls[0]


def _db_with(ideas, commits):
    db = MemoryDB()
    db.insert("ideas", ideas)
    db.insert("commits", commits)
    return db


def test_started_idea_completes_on_a_later_commit_only():
    db = _db_with(
        [{"id": "i1", "project_id": "27b", "status": "in_progress", "started_at": "2026-10-14T15:00:00+00:00"}],
        [{"sha": "old", "project_id": "27b", "committed_at": "2026-10-14T14:00:00Z"}],
    )
    assert P.complete_started_ideas(db) == 0
    assert db.select("ideas", {"id": "i1"})[0]["status"] == "in_progress"
    db.insert("commits", [{"sha": "new", "project_id": "27b", "committed_at": "2026-10-14T16:30:00Z"}])
    assert P.complete_started_ideas(db) == 1
    i = db.select("ideas", {"id": "i1"})[0]
    assert i["status"] == "done" and i["done_at"] == "2026-10-14T16:30:00Z"


def test_one_commit_completes_only_the_oldest_started_idea():
    db = _db_with(
        [{"id": "a", "project_id": "27b", "status": "in_progress", "started_at": "2026-10-14T10:00:00Z"},
         {"id": "b", "project_id": "27b", "status": "in_progress", "started_at": "2026-10-14T11:00:00Z"}],
        [{"sha": "c1", "project_id": "27b", "committed_at": "2026-10-14T12:00:00Z"}],
    )
    assert P.complete_started_ideas(db) == 1
    assert db.select("ideas", {"id": "a"})[0]["status"] == "done"
    assert db.select("ideas", {"id": "b"})[0]["status"] == "in_progress"


def test_commits_on_other_projects_do_not_count():
    db = _db_with(
        [{"id": "a", "project_id": "27b", "status": "in_progress", "started_at": "2026-10-14T10:00:00Z"}],
        [{"sha": "x", "project_id": "showboat", "committed_at": "2026-10-14T12:00:00Z"}],
    )
    assert P.complete_started_ideas(db) == 0


def test_in_progress_without_started_at_is_ignored():
    db = _db_with([{"id": "a", "project_id": "27b", "status": "in_progress", "started_at": None}],
                  [{"sha": "x", "project_id": "27b", "committed_at": "2026-10-14T12:00:00Z"}])
    assert P.complete_started_ideas(db) == 0


def test_pick_today_idea_keeps_an_in_progress_today_idea():
    # F5: Work on this moves today's idea to in_progress; it is still today's idea.
    db = _db()
    db.insert("ideas", [{"id": "cur", "project_id": "27b", "text": "a", "status": "in_progress",
                         "today_on": "2026-10-14", "started_at": "2026-10-14T13:00:00Z", "position": 0},
                        {"id": "next", "project_id": "showboat", "text": "b", "status": "todo", "position": 0}])
    assert projects.pick_today_idea(db, date(2026, 10, 14))["id"] == "cur"
    assert db.select("ideas", {"id": "next"})[0]["status"] == "todo"


def test_pick_today_idea_carries_over_an_in_progress_idea():
    db = _db()
    db.insert("ideas", [{"id": "cur", "project_id": "27b", "text": "a", "status": "in_progress",
                         "today_on": "2026-10-13", "started_at": "2026-10-13T13:00:00Z", "position": 0},
                        {"id": "next", "project_id": "showboat", "text": "b", "status": "todo", "position": 0}])
    idea = projects.pick_today_idea(db, date(2026, 10, 14))
    assert idea["id"] == "cur" and idea["status"] == "in_progress"
    row = db.select("ideas", {"id": "cur"})[0]
    assert row["status"] == "in_progress" and row["today_on"] == "2026-10-14"
    assert db.select("ideas", {"id": "next"})[0]["status"] == "todo"


def test_one_commit_completes_one_idea_when_today_idea_is_in_progress():
    # F5: plan job picks, then the sync job runs both completion passes; one commit = one idea done.
    db = _db()
    db.insert("ideas", [{"id": "cur", "project_id": "27b", "text": "a", "status": "in_progress",
                         "today_on": "2026-10-14", "started_at": "2026-10-14T13:00:00Z", "position": 0},
                        {"id": "other", "project_id": "27b", "text": "b", "status": "todo", "position": 1}])
    projects.pick_today_idea(db, date(2026, 10, 14))
    db.insert("commits", [{"sha": "c1", "project_id": "27b", "message": "m", "committed_at": "2026-10-14T15:00:00Z"}])
    now = datetime(2026, 10, 14, 12, tzinfo=TZ)
    projects.complete_idea_on_commit(db, date(2026, 10, 14), now)
    projects.complete_started_ideas(db)
    assert db.select("ideas", {"id": "cur"})[0]["status"] == "done"
    assert db.select("ideas", {"id": "other"})[0]["status"] == "todo"
