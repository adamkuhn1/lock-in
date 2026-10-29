"""Posting tiers: reach, volume or midwest (config/companies.yaml explains each).

A reach company's postings are always reach. Any other posting located in the Midwest is midwest.
Everything else takes its company's tier, and companies the scanner doesn't watch are volume."""

from __future__ import annotations

import re

from . import location as loc
from .config import TIERS, Company

REACH, VOLUME, MIDWEST = TIERS
RANK = {REACH: 0, MIDWEST: 1, VOLUME: 2}
MIDWEST_STATES = frozenset({"IL", "MI", "OH", "IN", "WI", "MN", "IA", "MO"})
_SUFFIX = re.compile(r"(?:\s+(?:inc|llc|ltd|corp|corporation|co|company|plc|holdings|technologies|labs))+$")


def in_midwest(texts) -> bool:
    """At least one US location in a Midwest state ("Chicago, IL", "Ann Arbor", "Remote; Detroit, MI")."""
    for seg in loc.segments(texts):
        verdict, states = loc.classify_segment(seg)
        if verdict == loc.US and states & MIDWEST_STATES:
            return True
    return False


def posting_tier(company_tier: str | None, location_texts) -> str:
    if company_tier == REACH:
        return REACH
    if in_midwest(location_texts):
        return MIDWEST
    return company_tier if company_tier in RANK else VOLUME


def company_key(name: str | None) -> str:
    """"The Home Depot, Inc." and "home depot" compare equal; so do "JPMorgan Chase & Co." and "JPMorgan Chase"."""
    s = " ".join(re.sub(r"[^a-z0-9]+", " ", (name or "").lower().replace("&", " and ")).split())
    s = re.sub(r"^the\s+", "", s)
    s = re.sub(r"\s+and\s+co$", "", s)
    return _SUFFIX.sub("", s).strip()


class TierIndex:
    """Company name (or alias) → tier, for postings and for applications read from the Sheet."""

    def __init__(self, companies: list[Company], lists=()):
        self._by_key: dict[str, str] = {}
        for c in companies:
            for n in (c.name, *c.aliases):
                if company_key(n):
                    self._by_key.setdefault(company_key(n), c.tier)

    def company_tier(self, name: str | None) -> str | None:
        return self._by_key.get(company_key(name))

    def tier(self, company: str | None, location_texts=(), fallback: str | None = None) -> str:
        return posting_tier(self.company_tier(company) or fallback, location_texts)
