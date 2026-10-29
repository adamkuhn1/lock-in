from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from . import clock
from .agenda import _d, agenda as _agenda


def activity_days(db) -> set[date]:
    """Plan days with any real work: a solve, application, outreach or LinkedIn note sent, commit or prep session."""
    days = {clock.plan_day(clock.parse_ts(s["accepted_at"])) for s in db.select("lc_solves") if s.get("accepted_at")}
    days |= {clock.plan_day(clock.parse_ts(c["committed_at"])) for c in db.select("commits") if c.get("committed_at")}
    for table, col in (("applications", "applied_on"), ("outreach", "sent_on"), ("referrals", "sent_on"),
                       ("prep_sessions", "happened_on")):
        days |= {d for d in (_d(r.get(col)) for r in db.select(table)) if d}
    return days


DEFAULT_DAY_ONE = date(2026, 9, 28)  # matches the settings.day_one column default


def day_one(db) -> date:
    rows = db.select("settings")
    return (_d(rows[0].get("day_one")) if rows else None) or DEFAULT_DAY_ONE


def streak(days: set[date], today: date) -> int:
    cur = today if today in days else today - timedelta(days=1)
    n = 0
    while cur in days:
        n += 1
        cur -= timedelta(days=1)
    return n


@dataclass(frozen=True)
class DayStatus:
    lc_done: int
    lc_total: int
    focus: str | None
    reviews: int
    mixed_day: bool
    project_done: bool
    idea_text: str | None
    new_postings: int
    starred_postings: int
    followups_due: int
    lc_streak: int
    project_streak: int
    lc_today: bool  # any accepted solve on today's calendar day, in the set or not
    has_projects: bool  # an active project or a today idea exists
    active_streak: int = 0
    active_today: bool = False
    agenda: tuple[str, ...] = ()


REFERRAL_FOLLOW_UP_DAYS = 3  # follow up 3-4 days after an engineer accepts
POSTINGS_WINDOW = timedelta(days=30)  # matches the web (usePostings: found_at >= now - 30 days)


def _recent(p: dict, cutoff: datetime) -> bool:
    return bool(p.get("found_at")) and clock.parse_ts(p["found_at"]) >= cutoff


def day_status(db, now: datetime) -> DayStatus:
    today = clock.local_day(now)
    pday = clock.plan_day(now).isoformat()
    sets = db.select("lc_daily_sets", {"day": pday})
    items = sets[0]["items"] if sets else []
    lc_days = {clock.local_day(clock.parse_ts(s["accepted_at"])) for s in db.select("lc_solves")}
    commit_days = {clock.local_day(clock.parse_ts(c["committed_at"])) for c in db.select("commits")}
    cutoff = now - POSTINGS_WINDOW
    postings = [p for p in db.select("postings", {"status": "new"}) if _recent(p, cutoff)]
    due = [o for o in db.select("outreach", {"status": "sent"})
           if o.get("follow_up_on") and o["follow_up_on"] <= today.isoformat()]
    # Engineers who accepted a connection: a follow-up message is due 3 days later (web: lib/referrals.ts).
    due += [r for r in db.select("referrals", {"status": "accepted"})
            if r.get("accepted_on") and not r.get("followed_up_on")
            and _d(r["accepted_on"]) + timedelta(days=REFERRAL_FOLLOW_UP_DAYS) <= today]
    active_projects = db.select("projects", {"active": True})
    idea = next((i for st in ("today", "in_progress") for i in db.select("ideas", {"status": st})
                 if i.get("today_on") == pday), None)
    pday_d = clock.plan_day(now)
    first = day_one(db)
    act = {d for d in activity_days(db) if d >= first}  # like the web: nothing before Day 1 counts
    return DayStatus(
        lc_done=sum(1 for i in items if i.get("done")), lc_total=len(items),
        focus=sets[0]["focus"] if sets else None,
        reviews=sum(1 for i in items if i["slot"] in ("review", "spot")),
        mixed_day=bool(sets and sets[0].get("mixed_day")),
        project_done=today in commit_days, idea_text=idea["text"] if idea else None,
        new_postings=len(postings), starred_postings=sum(1 for p in postings if p.get("starred")),
        followups_due=len(due), lc_streak=streak(lc_days, today), project_streak=streak(commit_days, today),
        lc_today=today in lc_days, has_projects=bool(idea or active_projects),
        active_streak=streak(act, pday_d), active_today=pday_d in act, agenda=tuple(_agenda(db, pday_d)),
    )
