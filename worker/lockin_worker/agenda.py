from __future__ import annotations

from datetime import date, timedelta


def _d(v) -> date | None:
    if not v:
        return None
    return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])


def agenda(db, day: date, limit: int = 3) -> list[str]:
    """Today's and tomorrow's calendar items as short phrases, earliest first."""
    tomorrow = day + timedelta(days=1)
    items: list[tuple[date, str, str]] = []
    for e in db.select("events"):
        d = _d(e.get("on_date"))
        if d in (day, tomorrow):
            items.append((d, str(e.get("at_time") or "99"), e["title"]))
    for p in db.select("company_prep"):
        d = _d(p.get("interview_on"))
        if d in (day, tomorrow):
            items.append((d, "99", f"{p['company']} interview"))
    for o in db.select("outreach", {"status": "sent"}):
        d = _d(o.get("follow_up_on"))
        if d in (day, tomorrow):
            items.append((d, "99~", f"Follow up: {o.get('company') or 'outreach'}"))
    items.sort(key=lambda t: (t[0], t[1], t[2]))
    return [f"{text} {'today' if d == day else 'tomorrow'}" for d, _, text in items[:limit]]
