from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .bank import Problem, Topic
from .engine import ProblemState
from .levels import rank

DIFFS = ("Easy", "Medium", "Hard")
FOCUS_DAYS = 10
HARD_AFTER_MEDIUMS = 30
MIN_FOCUS_MEDIUMS = 2  # a focus with fewer unseen free Mediums than this is exhausted and rotates
LADDERS = {
    "learning": ("Easy", "Easy", "Medium", "Medium"),
    "practicing": ("Easy", "Medium", "Medium", "Medium"),
    "solid": ("Medium", "Medium", "Medium", "Hard"),
}
LIST_RANK = {"nc150": 0, "blind75": 1, "grind169": 1, "nc250": 2}


@dataclass(frozen=True)
class Item:
    slug: str
    slot: str


@dataclass(frozen=True)
class DailyInput:
    today: date
    day_index: int
    n: int
    focus: str | None
    focus_since: date | None
    levels: dict[str, str]
    states: dict[str, ProblemState]
    attempted: frozenset[str]
    lifetime_mediums: int


@dataclass(frozen=True)
class DailyPlan:
    items: list[Item]
    focus: str
    focus_since: date
    mixed_day: bool


def _lvl(inp: DailyInput, topic: str) -> str:
    return inp.levels.get(topic, "locked")


def _key(p: Problem):
    return (min((LIST_RANK.get(l, 3) for l in p.lists), default=3), -p.ac_rate, p.slug)


def _unseen(inp: DailyInput, bank: dict[str, Problem], topic: str, diff: str, taken: set[str]) -> list[Problem]:
    pool = [p for p in bank.values() if p.topic == topic and p.difficulty == diff and not p.paid_only
            and p.slug not in inp.attempted and p.slug not in inp.states and p.slug not in taken]
    return sorted(pool, key=_key)


def _hard_ok(inp: DailyInput) -> bool:
    return inp.lifetime_mediums >= HARD_AFTER_MEDIUMS


def _eligible(inp: DailyInput, topics: list[Topic]) -> list[str]:
    # topics is in roadmap order
    return [t.name for t in topics
            if rank(_lvl(inp, t.name)) < rank("solid")
            and all(rank(_lvl(inp, p)) >= rank("practicing") for p in t.prereqs)]


def _exhausted(inp: DailyInput, bank: dict[str, Problem] | None, topic: str) -> bool:
    return bank is not None and len(_unseen(inp, bank, topic, "Medium", set())) < MIN_FOCUS_MEDIUMS


def choose_focus(inp: DailyInput, topics: list[Topic], bank: dict[str, Problem] | None = None) -> tuple[str, date]:
    eligible = _eligible(inp, topics)
    cur = inp.focus
    if cur and rank(_lvl(inp, cur)) < rank("solid"):
        fresh = (inp.focus_since is not None and (inp.today - inp.focus_since).days < FOCUS_DAYS
                 and not _exhausted(inp, bank, cur))
        if cur in eligible:
            i = eligible.index(cur)
            others = eligible[i + 1:] + eligible[:i]  # next after cur in roadmap order, wrapping
        else:
            others = eligible
        if fresh or not others:
            return cur, inp.focus_since or inp.today
        return others[0], inp.today
    if eligible:
        return eligible[0], inp.today
    return (cur or topics[0].name), (inp.focus_since or inp.today)


def _ladder(level: str, k: int, lifetime_mediums: int) -> list[str]:
    key = "solid" if rank(level) >= rank("solid") else "practicing" if level == "practicing" else "learning"
    out = (list(LADDERS[key]) + ["Medium"] * k)[:k]
    if lifetime_mediums < HARD_AFTER_MEDIUMS:
        out = ["Medium" if d == "Hard" else d for d in out]
    return sorted(out, key=DIFFS.index)


def _due(inp: DailyInput, bank, focus: str) -> list[ProblemState]:
    due = [s for s in inp.states.values() if s.state in ("learning", "reviewing")
           and s.due_on is not None and s.due_on <= inp.today and s.slug in bank]
    return sorted(due, key=lambda s: (bank[s.slug].topic != focus,
                                      -((inp.today - s.due_on).days / max(s.interval_days, 1)), s.slug))


def _spot(inp: DailyInput, bank) -> list[Item]:
    if inp.day_index % 7 != 3:
        return []
    retained = sorted((s for s in inp.states.values() if s.state == "retained" and s.slug in bank),
                      key=lambda s: (s.due_on or inp.today, s.slug))
    return [Item(retained[0].slug, "spot")] if retained else []


def _topup(inp, bank, topics, exclude: str | None, count: int, taken: set[str],
           diffs: tuple[str, ...] = ("Medium", "Easy", "Hard")) -> list[Item]:
    # fill short days with unseen free problems from other eligible topics, roadmap order
    if count <= 0:
        return []
    others = [t for t in _eligible(inp, topics) if t != exclude]
    diffs = [d for d in diffs if d != "Hard" or _hard_ok(inp)]
    out: list[Item] = []
    for diff in diffs:
        for topic in others:
            need = count - len(out)
            if need == 0:
                return out
            for p in _unseen(inp, bank, topic, diff, taken)[:need]:
                out.append(Item(p.slug, "new"))
                taken.add(p.slug)
    return out


def _mystery(inp, bank, topics, exclude: str | None, count: int, taken: set[str]) -> list[Item]:
    pool_topics = [t.name for t in topics if rank(_lvl(inp, t.name)) >= rank("practicing") and t.name != exclude]
    out: list[Item] = []
    if not pool_topics:
        return out
    start = inp.day_index % len(pool_topics)
    order = pool_topics[start:] + pool_topics[:start]
    i = 0
    while len(out) < count and i < count * len(order):
        topic = order[i % len(order)]
        cands = _unseen(inp, bank, topic, "Medium", taken)
        if cands:
            out.append(Item(cands[0].slug, "mystery"))
            taken.add(cands[0].slug)
        i += 1
    return out


def build_daily_set(inp: DailyInput, bank: dict[str, Problem], topics: list[Topic]) -> DailyPlan:
    focus, since = choose_focus(inp, topics, bank)
    practicing = [t for t in topics if rank(_lvl(inp, t.name)) >= rank("practicing")]
    taken: set[str] = set()

    if inp.day_index % 7 == 6 and len(practicing) >= 2:
        due = _due(inp, bank, focus)
        r = min(len(due), round(0.6 * inp.n))
        reviews = [Item(s.slug, "review") for s in due[:r]]
        taken |= {i.slug for i in reviews}
        rest = _mystery(inp, bank, topics, None, inp.n - r, taken)
        rest += _topup(inp, bank, topics, focus, inp.n - r - len(rest), taken)
        return DailyPlan(reviews + rest, focus, since, True)

    spot = _spot(inp, bank)
    taken |= {i.slug for i in spot}
    due = [s for s in _due(inp, bank, focus) if s.slug not in taken]
    r_budget = max(0, int(0.4 * inp.n) - len(spot))
    reviews = [Item(s.slug, "review") for s in due[:r_budget]]
    taken |= {i.slug for i in reviews}

    mystery = _mystery(inp, bank, topics, focus, 1, taken) if len(practicing) >= 2 else []
    k = inp.n - len(spot) - len(reviews) - len(mystery)

    # practicing+ focus: a non-Easy slot it can't fill goes to other topics' Mediums before its own Easies
    easy_last = rank(_lvl(inp, focus)) >= rank("practicing")
    news: list[Item] = []
    for diff in _ladder(_lvl(inp, focus), k, inp.lifetime_mediums):
        alts = (diff, "Medium", "Hard") if easy_last and diff != "Easy" else (diff, "Medium", "Hard", "Easy")
        for alt in alts:
            if alt == "Hard" and not _hard_ok(inp):
                continue
            cands = _unseen(inp, bank, focus, alt, taken)
            if cands:
                news.append(Item(cands[0].slug, "new"))
                taken.add(cands[0].slug)
                break
    fixed = len(spot) + len(reviews) + len(mystery)
    if easy_last:
        news += _topup(inp, bank, topics, focus, inp.n - fixed - len(news), taken, diffs=("Medium",))
        for p in _unseen(inp, bank, focus, "Easy", taken)[:max(inp.n - fixed - len(news), 0)]:
            news.append(Item(p.slug, "new"))
            taken.add(p.slug)
    news += _topup(inp, bank, topics, focus, inp.n - fixed - len(news), taken)
    news.sort(key=lambda it: DIFFS.index(bank[it.slug].difficulty))

    # mystery goes right after the first medium
    if mystery:
        idx = next((i + 1 for i, it in enumerate(news) if bank[it.slug].difficulty == "Medium"), len(news))
        news = news[:idx] + mystery + news[idx:]
    return DailyPlan(spot + reviews + news, focus, since, False)
