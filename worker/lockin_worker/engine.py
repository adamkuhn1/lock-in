"""When a problem comes back.

solo       next step on the 3/7/21/60/120-day ladder. An Easy solved solo on the first try is retained right away:
           reviewing it would only take a slot from new material.
explained  back in 3 days to try it solo.
codealong  back in 3 days to try it solo.
A second miss in a row (anything but solo) sets the problem aside for 3 weeks so it stops crowding the daily set.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta

INTERVALS = (3, 7, 21, 60, 120)
RATINGS = ("solo", "explained", "codealong")
RETAINED_AT = 60
RETRY_DAYS = 3
PARK_LAPSES = 2
PARK_DAYS = 21


@dataclass
class ProblemState:
    slug: str
    state: str = "new"
    interval_days: int = 0
    due_on: date | None = None
    lapses: int = 0


def apply_rating(ps: ProblemState, rating: str, day: date, difficulty: str = "Medium") -> ProblemState:
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating!r}")
    p = replace(ps)
    if rating == "solo":
        if difficulty == "Easy" and ps.state == "new":
            p.interval_days = RETAINED_AT
        else:
            p.interval_days = next((i for i in INTERVALS if i > p.interval_days), INTERVALS[-1])
        p.state = "retained" if p.interval_days >= RETAINED_AT else "reviewing"
        p.lapses = 0  # lapses counts misses in a row
    else:
        p.state, p.interval_days = "learning", RETRY_DAYS
        p.lapses += 1
    p.due_on = day + timedelta(days=p.interval_days)
    if p.lapses >= PARK_LAPSES and rating != "solo":
        p.state = "parked"
        p.due_on = day + timedelta(days=PARK_DAYS)
    return p
