from __future__ import annotations

from datetime import date, datetime

from . import clock, leetcode, projects
from .daily import DailyInput, build_daily_set


def _settings(db) -> dict:
    rows = db.select("settings")
    return rows[0] if rows else {}


def ensure_plan(db, now: datetime, bank, topics) -> bool:
    pday = clock.plan_day(now)
    if db.select("lc_daily_sets", {"day": pday.isoformat()}):
        return False
    s = _settings(db)
    started = date.fromisoformat(s["lc_started_on"]) if s.get("lc_started_on") else pday
    levels = {r["topic"]: r["level"] for r in db.select("lc_topic_state")}
    states = leetcode.load_states(db)
    solves = db.select("lc_solves")
    attempted = frozenset(x["slug"] for x in solves)
    unaided_mediums = {x["slug"] for x in solves if x["slug"] in bank and bank[x["slug"]].difficulty == "Medium"
                       and x.get("effective_rating") in ("nailed", "struggled")}
    inp = DailyInput(
        today=pday, day_index=(pday - started).days, n=int(s.get("daily_lc_count") or 6),
        focus=s.get("lc_focus_topic"),
        focus_since=date.fromisoformat(s["lc_focus_since"]) if s.get("lc_focus_since") else None,
        levels=levels, states=states, attempted=attempted, lifetime_mediums=len(unaided_mediums))
    p = build_daily_set(inp, bank, topics)
    db.upsert("lc_daily_sets", [{
        "day": pday.isoformat(), "focus": p.focus, "mixed_day": p.mixed_day,
        "items": [{"slug": it.slug, "slot": it.slot, "order": i, "done": False} for i, it in enumerate(p.items)],
    }], on_conflict="day")
    db.update("settings", {}, {"lc_started_on": started.isoformat(), "lc_focus_topic": p.focus,
                               "lc_focus_since": p.focus_since.isoformat()})
    projects.pick_today_idea(db, pday)
    return True


def refresh_done(db, now: datetime) -> int:
    pday = clock.plan_day(now).isoformat()
    sets = db.select("lc_daily_sets", {"day": pday})
    if not sets:
        return 0
    solved_today = {s["slug"] for s in db.select("lc_solves")
                    if clock.plan_day(clock.parse_ts(s["accepted_at"])).isoformat() == pday}
    items = sets[0]["items"]
    changed = 0
    for it in items:
        if not it["done"] and it["slug"] in solved_today:
            it["done"] = True
            changed += 1
    if changed:
        db.update("lc_daily_sets", {"day": pday}, {"items": items})
    return changed
