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
    active = [p for p in db.select("projects", {"active": True}) if p.get("repo")]
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


def _current_ideas(db) -> list[dict]:
    """Today's idea, whether still 'today' or started with Work on this ('in_progress' with today_on)."""
    return db.select("ideas", {"status": "today"}) + [
        i for i in db.select("ideas", {"status": "in_progress"}) if i.get("today_on")]


def pick_today_idea(db, day: date) -> dict | None:
    current = _current_ideas(db)
    for idea in current:
        if idea.get("today_on") == day.isoformat():
            return idea
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
    # 'today' only: an in_progress idea is completed by complete_started_ideas (commit after started_at).
    for idea in db.select("ideas", {"status": "today"}):
        commits = db.select("commits", {"project_id": idea["project_id"]})
        if any(clock.plan_day(clock.parse_ts(c["committed_at"])) == day for c in commits):
            db.update("ideas", {"id": idea["id"]}, {"status": "done", "done_at": now.isoformat()})
            return True
    return False


def complete_started_ideas(db) -> int:
    """Each in-progress idea is done by the first commit on its project made after it was started.
    Oldest-started ideas claim commits first; one commit completes at most one idea."""
    by_project: dict[str, list[dict]] = {}
    for idea in db.select("ideas", {"status": "in_progress"}):
        if idea.get("started_at"):
            by_project.setdefault(idea["project_id"], []).append(idea)
    done = 0
    for pid, ideas in by_project.items():
        commits = sorted(db.select("commits", {"project_id": pid}), key=lambda c: clock.parse_ts(c["committed_at"]))
        used: set[str] = set()
        for idea in sorted(ideas, key=lambda i: clock.parse_ts(i["started_at"])):
            t0 = clock.parse_ts(idea["started_at"])
            hit = next((c for c in commits if c["sha"] not in used and clock.parse_ts(c["committed_at"]) > t0), None)
            if hit is None:
                continue
            used.add(hit["sha"])
            db.update("ideas", {"id": idea["id"]}, {"status": "done", "done_at": hit["committed_at"]})
            done += 1
    return done
