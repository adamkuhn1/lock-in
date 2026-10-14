from pathlib import Path

import pytest

from job_radar.config import ConfigError, LocationRules, load_filters
from job_radar.location import FOREIGN, UNKNOWN, US, place

PREF = ("nyc", "chicago", "texas", "california")


# Real location strings seen on the boards / Simplify lists.
@pytest.mark.parametrize("loc", [
    "San Francisco", "SF", "NYC", "New York", "New York, NY (HQ)", "Chicago", "LA", "South SF",
    "Austin, TX", "Seattle, WA", "Washington, D.C.", "Remote - United States", "Remote, US",
    "Remote in the US", "US-CA-Menlo Park", "US-NY-New York City-Remote", "Remote - California",
    "Georgia", "Corvallis, OR", "New Mexico, USA, Remote", "Indianapolis, IN", "US / Canada",
    "Remote, Canada; Remote, United States", "San Francisco, CA | London, UK",
    "Toronto, New York, San Francisco, Atlanta, Seattle", "Chicago, Toronto",
    "SF-HQ, Chicago, New York, US-Remote", "SEA, SF, NYC, CHI", "Dublin, CA", "US-CA-Dublin",
    "Northeast - United States", "Remote (US)", "Remote U.S.",
])
def test_us(loc):
    assert place([loc]).verdict == US


@pytest.mark.parametrize("loc", [
    "London, UK", "London", "Toronto, ON, CA", "Toronto, ON", "Canada", "Remote, Canada",
    "Canada - Remote (ON, AB, BC, or NS Only)", "Bengaluru", "Singapore", "GB-London",
    "CA-Ontario-Toronto", "IN-Pune", "DE-Berlin-Trion Building", "Mexico City, MX", "Mexico",
    "Dublin, Ireland", "Dublin or London", "Poland - Remote OR Romania - Remote", "Ontario, CAN",
    "Israel - Hybrid (3 days/week in office required)", "Remote India", "Europe", "Vancouver, BC",
    "Zürich, Switzerland", "São Paulo, Brazil", "Remote, Canada; Remote, United Kingdom",
])
def test_foreign(loc):
    assert place([loc]).verdict == FOREIGN


@pytest.mark.parametrize("loc", ["", "Remote", "Hybrid", "Distributed", "In-Office", "N/A", "North America"])
def test_unknown(loc):
    assert place([loc]).verdict == UNKNOWN


def test_hints_resolve_vague_location():
    assert place(["Hybrid", "Austin, TX"]).verdict == US
    assert place(["Hybrid", "London, United Kingdom"]).verdict == FOREIGN
    assert place(["North America", "United States"]).verdict == US   # Ashby addressCountry
    assert place(["Remote", "SG-country"]).verdict == FOREIGN                # Lever country code


@pytest.mark.parametrize("loc", [
    "New York, NY", "NYC", "US-NY-New York", "Chicago, IL", "Austin, TX", "Dallas, Texas",
    "Remote - Texas", "San Francisco", "SF", "LA", "Remote - California", "US-CA-Menlo Park",
    "Mountain View, California", "Seattle, WA; San Jose, CA", "Seattle, Austin",
])
def test_preferred(loc):
    assert place([loc], PREF).preferred


@pytest.mark.parametrize("loc", [
    "Seattle, WA", "Rochester, NY", "Denver, CO", "Remote - United States", "Remote, Illinois",
    "Toronto, ON, CA",  # CA here is Canada
])
def test_not_preferred(loc):
    assert not place([loc], PREF).preferred


def test_rules():
    us, foreign, unknown = place(["Austin, TX"]), place(["London"]), place(["Remote"])
    strict = LocationRules(us_only=True, unknown="block")
    assert strict.allows(us) and not strict.allows(foreign) and not strict.allows(unknown)
    lenient = LocationRules(us_only=True, unknown="allow")
    assert lenient.allows(unknown) and not lenient.allows(foreign)
    assert LocationRules(us_only=False).allows(foreign)


def test_repo_config_is_us_only():
    f = load_filters(Path(__file__).parent.parent / "config/filters.yaml")
    assert f.location.us_only
    assert set(f.location.preferred) == set(PREF)


def test_bad_region_is_a_config_error(tmp_path):
    p = tmp_path / "filters.yaml"
    p.write_text("location:\n  preferred: [boston]\n")
    with pytest.raises(ConfigError):
        load_filters(p)
