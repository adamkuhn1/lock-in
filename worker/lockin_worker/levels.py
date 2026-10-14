from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .engine import ProblemState

LEVELS = ("locked", "available", "learning", "practicing", "solid", "mastered")
UNAIDED = {"nailed", "struggled"}


def rank(level: str) -> int:
    return LEVELS.index(level)


@dataclass(frozen=True)
class Attempt:
    slug: str
    topic: str
    difficulty: str
    rating: str
    on: date
    slot: str = "new"
    interval_before: int = 0


def _distinct(attempts, diff, ratings, **extra) -> set[str]:
    return {x.slug for x in attempts if x.difficulty == diff and x.rating in ratings
            and all(getattr(x, k) == v for k, v in extra.items())}


def topic_level(*, prev: str, attempts: list[Attempt], easy_pool: int, nc150: set[str],
                states: dict[str, ProblemState], prereq_levels: list[str], today: date) -> str:
    if not attempts:
        blocked = any(rank(p) < rank("practicing") for p in prereq_levels)
        return "locked" if blocked else "available"

    attempts = sorted(attempts, key=lambda x: x.on)
    easy_ok = len(_distinct(attempts, "Easy", UNAIDED)) >= min(3, max(easy_pool, 0))
    med_ok = len(_distinct(attempts, "Medium", UNAIDED)) >= 2
    if not (easy_ok and med_ok):
        return "learning"

    meds = [x for x in attempts if x.difficulty == "Medium"]
    last5 = meds[-5:]
    nailed5 = sum(x.rating == "nailed" for x in last5)
    was_solid = rank(prev) >= rank("solid")
    recent_ok = len(last5) == 5 and nailed5 >= (3 if was_solid else 4)
    spaced = {x.slug for x in meds if x.rating == "nailed" and x.interval_before >= 7}
    solid = len(_distinct(attempts, "Medium", {"nailed"})) >= 6 and len(spaced) >= 3 and recent_ok
    if not solid:
        return "practicing"

    lapses30 = sum(1 for x in attempts if x.rating == "help" and (today - x.on).days <= 30)
    nailed45 = any(x.rating == "nailed" and (today - x.on).days <= 45 for x in attempts)
    decay_ok = lapses30 < 2 and nailed45
    if prev == "mastered":
        return "mastered" if decay_ok else "solid"

    hard_ok = bool(_distinct(attempts, "Hard", UNAIDED))
    mystery = _distinct(attempts, "Medium", {"nailed"}, slot="mystery")
    if nc150:
        held = sum(1 for s in nc150 if s in states and states[s].interval_days >= 21)
        retained_ok = held / len(nc150) >= 0.75
    else:
        retained_ok = True
    return "mastered" if hard_ok and len(mystery) >= 2 and retained_ok and decay_ok else "solid"
