from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Job:
    """A posting normalized across every source."""

    company: str
    title: str
    location: str
    url: str
    posted_at: str | None  # ISO-8601 time the employer first published it, if known
    id: str  # unique within its source
    age: str | None = None  # coarse age reported by a list source, e.g. Simplify "0d"
    term: str | None = None  # internship term(s), e.g. "Winter 2027, Spring 2027"
    # Extra location hints from the ATS (offices, secondary locations, country)
    # used for the US filter — e.g. Greenhouse "Hybrid" + offices ("Austin, TX",).
    places: tuple[str, ...] = ()

    @property
    def location_texts(self) -> tuple[str, ...]:
        return (self.location, *self.places)


class FetchError(Exception):
    """A source could not be fetched or parsed (bad token, outage, format change)."""
