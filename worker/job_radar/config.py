from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from . import location as loc

ATS_TYPES = ("greenhouse", "lever", "ashby", "workday", "smartrecruiters", "amazon", "eightfold", "google", "apple", "meta", "oracle", "ibm")
TIERS = ("A", "B", "C")
BROAD_ATS = ("workday", "smartrecruiters", "amazon", "eightfold", "google", "apple", "meta", "oracle", "ibm")  # software_only defaults on for these


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Company:
    name: str
    ats: str
    token: str
    tier: str
    # Big employers (Workday/SmartRecruiters, hardware-heavy companies) post every kind of early-career
    # role; for them the title must also match filters.yaml `role` (software-ish work).
    software_only: bool = False

    @property
    def key(self) -> str:
        return f"{self.ats}:{self.token}"


@dataclass(frozen=True)
class GitHubList:
    name: str
    repo: str
    sections: list[str] = field(default_factory=list)
    tier: str = "B"
    apply_include: bool = False  # list is already curated; only apply excludes by default
    path: str | None = None  # file in the repo; None = the repo's README
    terms: list[str] = field(default_factory=list)  # keep rows whose Terms contain any of these

    @property
    def key(self) -> str:
        # README sources keep their original key so existing state stays valid
        return f"github:{self.repo}" if not self.path else f"github:{self.repo}:{self.path}"


UNKNOWN_POLICIES = ("allow", "block")


@dataclass(frozen=True)
class LocationRules:
    us_only: bool = False
    unknown: str = "allow"           # no usable location at all ("Remote", "Hybrid", "")
    preferred: tuple[str, ...] = ()  # keys of location.REGIONS

    def allows(self, placement: loc.Placement) -> bool:
        if not self.us_only or placement.verdict == loc.US:
            return True
        return placement.verdict == loc.UNKNOWN and self.unknown == "allow"


@dataclass(frozen=True)
class Filters:
    include: re.Pattern
    exclude: re.Pattern
    location: LocationRules = LocationRules()
    role: re.Pattern | None = None  # required only for software_only companies

    def matches(self, title: str, *, check_include: bool = True, software_only: bool = False) -> bool:
        if self.exclude.search(title):
            return False
        if software_only and self.role is not None and not self.role.search(title):
            return False
        return not check_include or bool(self.include.search(title))

    def placement(self, location_texts) -> loc.Placement:
        return loc.place(location_texts, self.location.preferred)


def term_matches(term: str | None, wanted: list[str] | tuple[str, ...]) -> bool:
    """No term filter → everything. Otherwise the row's Terms cell must mention one."""
    if not wanted:
        return True
    return bool(term) and any(w.lower() in term.lower() for w in wanted)


def _load_yaml(path: Path):
    try:
        return yaml.safe_load(path.read_text()) or {}
    except FileNotFoundError as exc:
        raise ConfigError(f"missing config file: {path}") from exc
    except yaml.YAMLError as exc:
        raise ConfigError(f"invalid YAML in {path}: {exc}") from exc


def load_companies(path: Path) -> list[Company]:
    data = _load_yaml(path)
    companies, keys = [], set()
    for i, raw in enumerate(data.get("companies") or []):
        where = f"{path.name} entry #{i + 1}"
        try:
            name, ats, token = str(raw["name"]).strip(), str(raw["ats"]).strip().lower(), str(raw["token"]).strip()
        except (KeyError, TypeError) as exc:
            raise ConfigError(f"{where}: needs name, ats, token") from exc
        tier = str(raw.get("tier", "B")).strip().upper()
        if ats not in ATS_TYPES:
            raise ConfigError(f"{where} ({name}): ats must be one of {ATS_TYPES}, got {ats!r}")
        if tier not in TIERS:
            raise ConfigError(f"{where} ({name}): tier must be one of {TIERS}, got {tier!r}")
        software_only = bool(raw.get("software_only", ats in BROAD_ATS))
        company = Company(name=name, ats=ats, token=token, tier=tier, software_only=software_only)
        if company.key in keys:
            raise ConfigError(f"{where} ({name}): duplicate {company.key}")
        keys.add(company.key)
        companies.append(company)
    return companies


def load_lists(path: Path) -> list[GitHubList]:
    data = _load_yaml(path)
    lists = []
    for raw in data.get("github_lists") or []:
        tier = str(raw.get("tier", "B")).upper()
        if tier not in TIERS:
            raise ConfigError(f"{path.name} ({raw.get('repo')}): bad tier {tier!r}")
        lists.append(
            GitHubList(
                name=raw.get("name") or raw["repo"],
                repo=raw["repo"],
                sections=list(raw.get("sections") or []),
                tier=tier,
                apply_include=bool(raw.get("apply_include", False)),
                path=raw.get("path") or None,
                terms=[str(t) for t in (raw.get("terms") or [])],
            )
        )
    return lists


def _compile(patterns: list[str], label: str) -> re.Pattern:
    if not patterns:
        return re.compile(r"(?!x)x")  # never matches
    try:
        return re.compile("|".join(f"(?:{p})" for p in patterns), re.I)
    except re.error as exc:
        raise ConfigError(f"filters.yaml {label}: bad regex: {exc}") from exc


def load_filters(path: Path) -> Filters:
    data = _load_yaml(path)
    title = data.get("title") or {}
    return Filters(
        include=_compile(title.get("include") or [], "include"),
        exclude=_compile(title.get("exclude") or [], "exclude"),
        location=_location_rules(data.get("location") or {}),
        role=_compile((data.get("role") or {}).get("include") or [], "role.include") if (data.get("role") or {}).get("include") else None,
    )


def _location_rules(raw: dict) -> LocationRules:
    unknown = str(raw.get("unknown", "allow")).lower()
    if unknown not in UNKNOWN_POLICIES:
        raise ConfigError(f"filters.yaml location.unknown must be one of {UNKNOWN_POLICIES}, got {unknown!r}")
    preferred = tuple(str(r).lower() for r in raw.get("preferred") or [])
    bad = [r for r in preferred if r not in loc.REGIONS]
    if bad:
        raise ConfigError(f"filters.yaml location.preferred: unknown {bad}; choose from {sorted(loc.REGIONS)}")
    return LocationRules(us_only=bool(raw.get("us_only", False)), unknown=unknown, preferred=preferred)
