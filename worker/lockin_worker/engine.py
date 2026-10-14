from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta

INTERVALS = (3, 7, 21, 60, 120)
RATINGS = ("nailed", "struggled", "help")
RETAINED_AT = 60
PARK_LAPSES = 3
PARK_DAYS = 14


@dataclass
class ProblemState:
    slug: str
    state: str = "new"
    interval_days: int = 0
    due_on: date | None = None
    lapses: int = 0


def apply_rating(ps: ProblemState, rating: str, day: date) -> ProblemState:
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating!r}")
    p = replace(ps)
    if rating == "help":
        p.state, p.interval_days = "learning", 1
        p.lapses += 1
    elif rating == "struggled":
        p.interval_days = max(1, p.interval_days + 1, round(p.interval_days * 1.2))
        p.state = "reviewing"
    else:
        p.interval_days = next((i for i in INTERVALS if i > p.interval_days), INTERVALS[-1])
        p.state = "retained" if p.interval_days >= RETAINED_AT else "reviewing"
    p.due_on = day + timedelta(days=p.interval_days)
    if p.lapses >= PARK_LAPSES and rating != "nailed":
        p.state = "parked"
        p.due_on = day + timedelta(days=PARK_DAYS)
    return p
