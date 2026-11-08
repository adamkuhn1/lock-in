"""Topic mastery. The rules live in shared/mastery.json so the web app shows the same levels the worker plans with.

A topic is mastered when Adam can solve nearly any Medium on his own, has cleared every Easy, and has worked
through some Hards (help allowed). "Nearly any Medium" is judged on first tries only: the rating of the first
attempt at each Medium. Repeats can't fake it.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path

LEVELS = ("locked", "available", "learning", "practicing", "solid", "mastered")
RULES = json.loads((Path(__file__).resolve().parents[2] / "shared" / "mastery.json").read_text(encoding="utf-8"))
RATINGS = tuple(RULES["ratings"])
EASY_COUNTS = frozenset(RULES["easyCounts"])


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


@dataclass(frozen=True)
class Pools:
    """Free problems in the topic, by difficulty."""
    easy: int
    medium: int
    hard: int


@dataclass(frozen=True)
class Progress:
    easy_cleared: int
    easy_total: int
    first_tries: tuple[str, ...]  # rating of the first attempt at each Medium, oldest first
    medium_solo: int  # distinct Mediums solved solo at least once
    hards_tried: int
    hard_total: int


def progress(attempts: list[Attempt], pools: Pools) -> Progress:
    attempts = sorted(attempts, key=lambda x: (x.on, x.slot != "new"))
    easy = {x.slug for x in attempts if x.difficulty == "Easy" and x.rating in EASY_COUNTS}
    first: dict[str, str] = {}
    for x in attempts:
        if x.difficulty == "Medium" and x.slug not in first:
            first[x.slug] = x.rating
    solo = {x.slug for x in attempts if x.difficulty == "Medium" and x.rating == "solo"}
    hards = {x.slug for x in attempts if x.difficulty == "Hard"}
    return Progress(min(len(easy), pools.easy), pools.easy, tuple(first.values()), len(solo),
                    min(len(hards), pools.hard), pools.hard)


def _window_ok(p: Progress, rule: dict, medium_pool: int) -> bool:
    window = min(rule["window"], medium_pool)
    if window == 0:
        return True
    recent = p.first_tries[-window:]
    need = math.ceil(rule["firstTrySolo"] * window / rule["window"])
    return len(recent) == window and sum(r == "solo" for r in recent) >= need


def level_from(p: Progress, pools: Pools, has_attempts: bool, prereq_levels: list[str]) -> str:
    if not has_attempts:
        return "locked" if any(rank(x) < rank("practicing") for x in prereq_levels) else "available"
    pr, so, ma = RULES["practicing"], RULES["solid"], RULES["mastered"]
    if not (p.easy_cleared >= min(pr["easy"], pools.easy) and p.medium_solo >= min(pr["mediumSolo"], pools.medium)):
        return "learning"
    if not (p.easy_cleared >= math.ceil(so["easyShare"] * pools.easy) and _window_ok(p, so, pools.medium)):
        return "practicing"
    if not (p.easy_cleared >= math.ceil(ma["easyShare"] * pools.easy) and _window_ok(p, ma, pools.medium)
            and p.hards_tried >= min(ma["hards"], pools.hard)):
        return "solid"
    return "mastered"


def topic_level(*, attempts: list[Attempt], pools: Pools, prereq_levels: list[str]) -> str:
    return level_from(progress(attempts, pools), pools, bool(attempts), prereq_levels)
