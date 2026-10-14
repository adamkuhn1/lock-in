from __future__ import annotations

from datetime import date, datetime, timedelta

import requests

from . import clock

API = "https://api.github.com/repos/{repo}/commits"
LOOKBACK_DAYS = 30


class GitHubError(Exception):
    pass


def fetch_commits(session, repo: str, since_iso: str, token: str | None) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = session.get(API.format(repo=repo), params={"since": since_iso, "per_page": 100},
                       headers=headers, timeout=30)
    if resp.status_code != 200:
        raise GitHubError(f"{repo}: HTTP {resp.status_code} {resp.text[:200]}")
    return [{"sha": c["sha"], "message": (c["commit"]["message"].splitlines() or [""])[0] or "(no message)",
             "committed_at": c["commit"]["author"]["date"]} for c in resp.json()]


def sync(db, session, token: str | None, now: datetime) -> dict:
    since = (now - timedelta(days=LOOKBACK_DAYS)).isoformat()
    active = db.select("projects", {"active": True})
    total = 0
    errors: dict[str, str] = {}
    for p in active:
        try:
            rows = [{**c, "project_id": p["id"]} for c in fetch_commits(session, p["repo"], since, token)]
            db.upsert("commits", rows, on_conflict="sha")
        except (GitHubError, requests.RequestException) as e:
            errors[p["repo"]] = str(e)
            continue
        total += len(rows)
    if active and len(errors) == len(active):
        raise GitHubError("; ".join(errors.values()))
    result = {"commits": total}
    if errors:
        result["errors"] = errors
    return result


def _last_commit(db, project_id: str) -> datetime | None:
    times = [clock.parse_ts(c["committed_at"]) for c in db.select("commits", {"project_id": project_id})]
    return max(times) if times else None


def pick_today_idea(db, day: date) -> dict | None:
    for idea in db.select("ideas", {"status": "today"}):
        if idea.get("today_on") == day.isoformat():
            return idea
    current = db.select("ideas", {"status": "today"})
    if current:  # yesterday's idea wasn't finished: carry it over to today
        db.update("ideas", {"id": current[0]["id"]}, {"today_on": day.isoformat()})
        return {**current[0], "today_on": day.isoformat()}
    active = db.select("projects", {"active": True})
    epoch = datetime.min.replace(tzinfo=clock.TZ)
    for p in sorted(active, key=lambda p: (_last_commit(db, p["id"]) or epoch, p["id"])):
        todo = sorted(db.select("ideas", {"project_id": p["id"], "status": "todo"}),
                      key=lambda i: (i.get("position", 0), str(i.get("created_at", ""))))
        if todo:
            db.update("ideas", {"id": todo[0]["id"]}, {"status": "today", "today_on": day.isoformat()})
            return {**todo[0], "status": "today", "today_on": day.isoformat()}
    return None


def complete_idea_on_commit(db, day: date, now: datetime) -> bool:
    for idea in db.select("ideas", {"status": "today"}):
        commits = db.select("commits", {"project_id": idea["project_id"]})
        if any(clock.local_day(clock.parse_ts(c["committed_at"])) == day for c in commits):
            db.update("ideas", {"id": idea["id"]}, {"status": "done", "done_at": now.isoformat()})
            return True
    return False
