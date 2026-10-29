from pathlib import Path

import pytest

from job_radar import tiers
from job_radar.config import Company, GitHubList, load_companies, load_filters
from job_radar.models import Job
from job_radar.radar import build_sources

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("texts, want", [
    (("Chicago, IL",), True),
    (("Ann Arbor",), True),
    (("Remote; Detroit, MI",), True),
    (("Columbus, Ohio",), True),
    (("San Francisco, CA",), False),
    (("New York, NY", "Chicago"), True),  # an office in Chicago counts
    (("Remote",), False),
    (("",), False),
])
def test_in_midwest(texts, want):
    assert tiers.in_midwest(texts) is want


def test_reach_company_stays_reach_in_the_midwest():
    assert tiers.posting_tier("reach", ("Chicago, IL",)) == "reach"


def test_volume_company_in_the_midwest_is_midwest():
    assert tiers.posting_tier("volume", ("Chicago, IL",)) == "midwest"
    assert tiers.posting_tier("volume", ("Austin, TX",)) == "volume"


def test_midwest_company_keeps_its_tier_elsewhere():
    assert tiers.posting_tier("midwest", ("Phoenix, AZ",)) == "midwest"


def test_unknown_company_is_volume():
    assert tiers.posting_tier(None, ("Seattle, WA",)) == "volume"


@pytest.mark.parametrize("a, b", [
    ("The Home Depot, Inc.", "home depot"),
    ("JPMorgan Chase & Co.", "JPMorgan Chase"),
    ("Stripe, Inc", "stripe"),
    ("Scale AI", "scale ai"),
])
def test_company_key_ignores_suffixes(a, b):
    assert tiers.company_key(a) == tiers.company_key(b)


def test_index_matches_aliases():
    idx = tiers.TierIndex([Company("JPMorgan Chase", "oracle", "x", "volume", aliases=("JP Morgan",)),
                           Company("Apple", "apple", "apple", "reach")])
    assert idx.company_tier("J.P. Morgan") is None  # not an alias
    assert idx.company_tier("JP Morgan") == "volume"
    assert idx.tier("Apple Inc.", ("Chicago, IL",)) == "reach"
    assert idx.tier("JP Morgan", ("Chicago, IL",)) == "midwest"
    assert idx.tier("Nobody", ()) == "volume"


def test_repo_config_has_no_trading_firms():
    filters = load_filters(ROOT / "config/filters.yaml")
    companies = load_companies(ROOT / "config/companies.yaml")
    assert [c.name for c in companies if filters.excluded_company(c.name)] == []


@pytest.mark.parametrize("name", ["Jane Street", "Citadel Securities", "Hudson River Trading", "Optiver", "IMC Trading",
                                  "Akuna Capital", "DRW", "Chicago Trading Company", "Susquehanna International Group",
                                  "Jump Trading", "Five Rings", "Two Sigma", "Tower Research Capital", "Maven Securities",
                                  "Edgehog Trading", "Belvedere Trading", "Old Mission Capital", "SIG", "HRT"])
def test_trading_firms_are_excluded(name):
    assert load_filters(ROOT / "config/filters.yaml").excluded_company(name)


@pytest.mark.parametrize("name", ["Capital One", "JPMorgan Chase", "Goldman Sachs", "Stripe", "Robinhood", "Sigma Computing",
                                  "Maven Clinic", "American Tower", "Kalshi", "Clear Street", "Talos", "Arcesium", "IMC Companies"])
def test_banks_fintech_and_lookalikes_stay(name):
    assert not load_filters(ROOT / "config/filters.yaml").excluded_company(name)


def test_list_rows_from_trading_firms_never_match():
    filters = load_filters(ROOT / "config/filters.yaml")
    src = build_sources([], [GitHubList(name="NG", repo="a/b")])[0]
    job = lambda company: Job(company, "Software Engineer, New Grad 2027", "New York, NY", "https://x", None, company)
    assert not src.matches(job("Jane Street"), filters)
    assert src.matches(job("Ramp"), filters)


def test_company_key_cases_shared_with_the_web():
    import json
    for name, key in json.loads((ROOT.parent / "shared/company-key-cases.json").read_text()):
        assert tiers.company_key(name) == key, name
