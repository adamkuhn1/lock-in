from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from importlib import resources


@dataclass(frozen=True)
class Problem:
    slug: str
    title: str
    difficulty: str
    topic: str
    lists: tuple[str, ...]
    paid_only: bool
    ac_rate: float
    target_minutes: int | None
    lc_id: int | None = None
    neetcode_link: str | None = None


@dataclass(frozen=True)
class Topic:
    name: str
    order: int
    tier: int
    prereqs: tuple[str, ...]
    lc_tags: tuple[str, ...]


def _read(name: str):
    return json.loads(resources.files("lockin_worker.data").joinpath(name).read_text())


@cache
def load_bank() -> dict[str, Problem]:
    out = {}
    for r in _read("problems.json"):
        out[r["slug"]] = Problem(
            slug=r["slug"], title=r["title"], difficulty=r["difficulty"], topic=r["neetcodeTopic"],
            lists=tuple(r.get("lists") or ()), paid_only=bool(r.get("paidOnly")),
            ac_rate=float(r.get("acRate") or 0.0), target_minutes=r.get("grindMinutes"),
            lc_id=r.get("id"), neetcode_link=r.get("neetcodeLink"),
        )
    return out


@cache
def load_topics() -> list[Topic]:
    raw = _read("roadmap.json")["topics"]
    topics = [Topic(name=t["topic"], order=int(t["order"]), tier=int(t["tier"]),
                    prereqs=tuple(t.get("prerequisites") or ()), lc_tags=tuple(t.get("lcTags") or ()))
              for t in raw]
    return sorted(topics, key=lambda t: t.order)
