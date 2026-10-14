from __future__ import annotations

from datetime import date, datetime

from . import clock
from .bank import Problem, Topic
from .engine import ProblemState, apply_rating
from .levels import Attempt, topic_level

GQL = "https://leetcode.com/graphql"
HEADERS = {"Content-Type": "application/json", "Referer": "https://leetcode.com"}
RECENT_Q = "query($u:String!){recentAcSubmissionList(username:$u,limit:20){title titleSlug timestamp}}"
TAGS_Q = ("query($u:String!){matchedUser(username:$u){tagProblemCounts{"
          "advanced{tagSlug problemsSolved} intermediate{tagSlug problemsSolved} "
          "fundamental{tagSlug problemsSolved}}}}")


class LeetCodeError(Exception):
    pass


def _gql(session, query: str, username: str) -> dict:
    resp = session.post(GQL, json={"query": query, "variables": {"u": username}}, headers=HEADERS, timeout=30)
    if resp.status_code != 200:
        raise LeetCodeError(f"HTTP {resp.status_code}")
    body = resp.json()
    if body.get("errors") or not body.get("data"):
        raise LeetCodeError(f"GraphQL error: {body.get('errors')}")
    return body["data"]


def fetch_recent(session, username: str) -> list[dict]:
    rows = _gql(session, RECENT_Q, username)["recentAcSubmissionList"] or []
    return [{"slug": r["titleSlug"], "title": r["title"],
             "accepted_at": clock.from_epoch(r["timestamp"]).isoformat()} for r in rows]


def fetch_tag_counts(session, username: str) -> dict[str, int]:
    user = _gql(session, TAGS_Q, username)["matchedUser"]
    if not user:
        raise LeetCodeError(f"unknown LeetCode user {username!r}")
    counts = user.get("tagProblemCounts")
    if not counts:
        return {}
    out = {}
    for group in counts.values():
        for t in group or []:
            out[t["tagSlug"]] = int(t["problemsSolved"])
    return out


def _ts_key(ts: str) -> datetime:
    return clock.parse_ts(ts)


def store_solves(db, solves: list[dict]) -> int:
    existing = {(s["slug"], _ts_key(s["accepted_at"])) for s in db.select("lc_solves")}
    new = []
    for s in solves:
        key = (s["slug"], _ts_key(s["accepted_at"]))
        if key in existing:
            continue
        existing.add(key)  # also dedupe within this batch
        new.append(s)
    if new:  # upsert-ignore: the web app may record the same solve concurrently
        db.upsert("lc_solves", [{**s, "rating": None} for s in new], on_conflict="slug,accepted_at",
                  ignore_duplicates=True)
    return len(new)


def store_tag_counts(db, counts: dict[str, int], now: datetime) -> None:
    db.upsert("lc_tag_counts", [{"tag": t, "solved": n, "synced_at": now.isoformat()} for t, n in counts.items()],
              on_conflict="tag")


def load_states(db) -> dict[str, ProblemState]:
    out = {}
    for r in db.select("lc_problem_state"):
        due = date.fromisoformat(r["due_on"]) if r.get("due_on") else None
        out[r["slug"]] = ProblemState(r["slug"], r["state"], int(r["interval_days"]), due, int(r["lapses"]))
    return out


def _slots_by_day(db) -> dict[str, dict[str, str]]:
    return {s["day"]: {i["slug"]: i["slot"] for i in s["items"]} for s in db.select("lc_daily_sets")}


def _match(s: dict) -> dict:
    return {"id": s["id"]} if "id" in s else {"slug": s["slug"], "accepted_at": s["accepted_at"]}


def _group_rating(rows: list[dict], day: date, today: date) -> str | None:
    """Rating for one (slug, day) attempt, or None to defer it.

    Earliest solve's rating wins; otherwise the first non-null rating in time order;
    otherwise an unrated past day counts as struggled; unrated today waits.
    """
    for r in rows:  # time order: the earliest solve's rating wins if set
        if r.get("rating"):
            return r["rating"]
    return "struggled" if day < today else None


def apply_pending(db, bank: dict[str, Problem], today: date, now: datetime) -> int:
    solves = sorted(db.select("lc_solves"), key=lambda s: _ts_key(s["accepted_at"]))
    states = load_states(db)
    slots = _slots_by_day(db)
    done_keys = {(s["slug"], clock.plan_day(_ts_key(s["accepted_at"])))
                 for s in solves if s.get("applied_at") and s.get("effective_rating")}
    groups: dict[tuple[str, date], list[dict]] = {}
    for s in solves:
        if s.get("applied_at"):
            continue
        if s["slug"] not in bank:
            db.update("lc_solves", _match(s), {"applied_at": now.isoformat()})
            continue
        day = clock.plan_day(_ts_key(s["accepted_at"]))  # one attempt per plan day (4 AM boundary)
        groups.setdefault((s["slug"], day), []).append(s)

    applied = 0
    for (slug, day), rows in groups.items():  # one attempt per (slug, plan day)
        if (slug, day) in done_keys:
            for r in rows:
                db.update("lc_solves", _match(r), {"applied_at": now.isoformat()})
            continue
        rating = _group_rating(rows, day, today)
        if rating is None:
            continue  # give Adam the rest of the day to rate it
        before = states.get(slug, ProblemState(slug))
        after = apply_rating(before, rating, day)
        states[slug] = after
        db.upsert("lc_problem_state", [{"slug": after.slug, "state": after.state,
                                        "interval_days": after.interval_days,
                                        "due_on": after.due_on.isoformat() if after.due_on else None,
                                        "lapses": after.lapses}], on_conflict="slug")
        first, rest = rows[0], rows[1:]
        slot = slots.get(day.isoformat(), {}).get(slug, "new")  # sets are keyed by plan day
        db.update("lc_solves", _match(first), {"applied_at": now.isoformat(), "effective_rating": rating,
                                               "interval_before": before.interval_days, "slot": slot})
        for r in rest:
            db.update("lc_solves", _match(r), {"applied_at": now.isoformat()})
        done_keys.add((slug, day))
        applied += 1
    return applied


def load_attempts(db, bank: dict[str, Problem]) -> list[Attempt]:
    out = []
    for s in db.select("lc_solves"):
        p = bank.get(s["slug"])
        if p and s.get("effective_rating"):
            out.append(Attempt(p.slug, p.topic, p.difficulty, s["effective_rating"],
                               clock.local_day(_ts_key(s["accepted_at"])), s.get("slot") or "new",
                               int(s.get("interval_before") or 0)))
    return out


def recompute_levels(db, bank, topics: list[Topic], today: date) -> dict[str, str]:
    attempts = load_attempts(db, bank)
    states = load_states(db)
    prev = {r["topic"]: r["level"] for r in db.select("lc_topic_state")}
    result: dict[str, str] = {}
    for t in topics:  # roadmap order puts prerequisites first
        in_topic = [x for x in attempts if x.topic == t.name]
        pool = [p for p in bank.values() if p.topic == t.name and not p.paid_only]
        result[t.name] = topic_level(
            prev=prev.get(t.name, "locked"), attempts=in_topic,
            easy_pool=sum(p.difficulty == "Easy" for p in pool),
            nc150={p.slug for p in pool if "nc150" in p.lists},
            states=states, prereq_levels=[result.get(x, "locked") for x in t.prereqs], today=today)
    db.upsert("lc_topic_state", [{"topic": k, "level": v, "updated_at": clock.now().isoformat()}
                                 for k, v in result.items()], on_conflict="topic")
    return result


def sync(db, session, username: str, now: datetime) -> dict:
    added = store_solves(db, fetch_recent(session, username))
    store_tag_counts(db, fetch_tag_counts(session, username), now)
    return {"new_solves": added}
