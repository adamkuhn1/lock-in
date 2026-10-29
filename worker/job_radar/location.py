"""Is a posting in the US, and is it somewhere Adam would most like to be?

Location strings are free text written by each company, so this works on
signals rather than a parser. Every string a job carries (its location plus any
office / secondary-location / country hints from the ATS) is split into
segments ("San Francisco, CA | London, UK" → two). Each segment is classified,
strongest signal first:

  1. explicit US          "United States", "USA", "Remote (US)", "US-CA-Menlo Park"
  2. foreign country      "Canada", "London, UK", "Toronto, ON", "GB-London"
  3. US state             "Austin, TX", "Remote - California", "Washington, D.C."
  4. foreign city         "Bengaluru", "Dublin", "Singapore"
  5. US city              "SF", "NYC", "Seattle", "Chicago"

A job is US if ANY segment is US (a "San Francisco or London" role is open to
you in SF). It's non-US if segments carry only foreign signals. With no signal
at all ("Remote", "Hybrid", "") it's unknown.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

US, FOREIGN, UNKNOWN = "us", "foreign", "unknown"

STATES = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california",
    "CO": "colorado", "CT": "connecticut", "DE": "delaware", "DC": "district of columbia",
    "FL": "florida", "GA": "georgia", "HI": "hawaii", "ID": "idaho", "IL": "illinois",
    "IN": "indiana", "IA": "iowa", "KS": "kansas", "KY": "kentucky", "LA": "louisiana",
    "ME": "maine", "MD": "maryland", "MA": "massachusetts", "MI": "michigan", "MN": "minnesota",
    "MS": "mississippi", "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada",
    "NH": "new hampshire", "NJ": "new jersey", "NM": "new mexico", "NY": "new york",
    "NC": "north carolina", "ND": "north dakota", "OH": "ohio", "OK": "oklahoma", "OR": "oregon",
    "PA": "pennsylvania", "RI": "rhode island", "SC": "south carolina", "SD": "south dakota",
    "TN": "tennessee", "TX": "texas", "UT": "utah", "VT": "vermont", "VA": "virginia",
    "WA": "washington", "WV": "west virginia", "WI": "wisconsin", "WY": "wyoming", "PR": "puerto rico",
}
_STATE_BY_NAME = {name: code for code, name in STATES.items()}

# Bare city names companies use without a state. Value = state, for preferences.
US_CITIES = {
    "new york city": "NY", "nyc": "NY", "new york": "NY", "brooklyn": "NY", "manhattan": "NY",
    "san francisco": "CA", "sf": "CA", "south sf": "CA", "south san francisco": "CA",
    "bay area": "CA", "silicon valley": "CA", "los angeles": "CA", "palo alto": "CA",
    "mountain view": "CA", "menlo park": "CA", "sunnyvale": "CA", "san jose": "CA",
    "santa clara": "CA", "redwood city": "CA", "san mateo": "CA", "foster city": "CA",
    "oakland": "CA", "berkeley": "CA", "cupertino": "CA", "san diego": "CA", "irvine": "CA",
    "santa monica": "CA", "chicago": "IL", "chi": "IL", "austin": "TX", "dallas": "TX",
    "houston": "TX", "san antonio": "TX", "plano": "TX", "irving": "TX", "frisco": "TX",
    "seattle": "WA", "sea": "WA", "bellevue": "WA", "redmond": "WA", "kirkland": "WA",
    "boston": "MA", "denver": "CO", "boulder": "CO", "atlanta": "GA", "miami": "FL",
    "philadelphia": "PA", "pittsburgh": "PA", "portland": "OR", "phoenix": "AZ",
    "salt lake city": "UT", "minneapolis": "MN", "detroit": "MI", "nashville": "TN",
    "raleigh": "NC", "charlotte": "NC", "baltimore": "MD", "mclean": "VA", "reston": "VA",
    # Midwest, for the midwest tier (job_radar/tiers.py)
    "ann arbor": "MI", "grand rapids": "MI", "lansing": "MI", "east lansing": "MI", "kalamazoo": "MI",
    "midland": "MI", "dearborn": "MI", "auburn hills": "MI", "mount pleasant": "MI", "southfield": "MI",
    "evanston": "IL", "naperville": "IL", "northbrook": "IL", "deerfield": "IL", "schaumburg": "IL",
    "columbus": "OH", "cleveland": "OH", "cincinnati": "OH", "indianapolis": "IN", "milwaukee": "WI",
    "madison": "WI", "st. louis": "MO", "st louis": "MO", "saint louis": "MO", "kansas city": "MO",
    "des moines": "IA", "st. paul": "MN", "saint paul": "MN",
}

# Countries / regions that are never the US. ("Georgia" and "Jersey" are left
# out on purpose — in a US job feed they're the state.)
FOREIGN_COUNTRIES = {
    "canada", "uk", "u.k.", "united kingdom", "england", "scotland", "wales",
    "great britain", "ireland", "mexico", "brazil", "argentina", "chile", "colombia", "peru",
    "germany", "france", "spain", "portugal", "italy", "netherlands", "the netherlands",
    "belgium", "switzerland", "austria", "poland", "romania", "serbia", "czech republic",
    "czechia", "hungary", "greece", "ukraine", "lithuania", "latvia", "estonia", "slovenia",
    "croatia", "bulgaria", "denmark", "sweden", "norway", "finland", "iceland", "luxembourg",
    "european union", "europe", "emea", "apac", "latam", "india", "china", "japan",
    "south korea", "korea", "taiwan", "hong kong", "singapore", "malaysia", "indonesia",
    "thailand", "vietnam", "philippines", "australia", "new zealand", "israel", "turkey",
    "united arab emirates", "uae", "saudi arabia", "qatar", "egypt", "nigeria", "kenya",
    "south africa", "pakistan", "bangladesh", "costa rica", "apj", "cdmx",
}
CANADIAN_PROVINCES = {
    "ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan",
    "nova scotia", "new brunswick", "newfoundland",
}
# Two-letter province codes are only trusted after a comma ("Toronto, ON").
_PROVINCE_CODE = re.compile(r",\s*(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE)\b")

FOREIGN_CITIES = {
    "london", "dublin", "toronto", "vancouver", "montreal", "ottawa", "waterloo", "calgary",
    "mississauga", "burnaby", "oakville", "longueuil", "bengaluru", "bangalore", "hyderabad",
    "pune", "mumbai", "delhi", "new delhi", "gurugram", "gurgaon", "chennai", "noida", "tokyo",
    "osaka", "seoul", "sydney", "melbourne", "paris", "berlin", "munich", "amsterdam",
    "warsaw", "krakow", "belgrade", "stockholm", "madrid", "barcelona", "milan", "lisbon",
    "zurich", "zürich", "geneva", "sao paulo", "são paulo", "mexico city", "buenos aires",
    "dubai", "abu dhabi", "riyadh", "doha", "tel aviv", "bangkok", "jakarta", "manila",
    "auckland", "vilnius", "ljubljana", "reykjavik", "reykjavík", "aarhus", "copenhagen",
    "belfast", "edinburgh", "manchester", "shanghai", "beijing", "shenzhen", "taipei",
    "prague", "brussels", "budapest", "bucharest", "kyiv", "cape town", "nairobi", "lagos",
}

# Region keys usable in filters.yaml → location.preferred
_NYC = re.compile(r"\b(new york|nyc|brooklyn|manhattan)\b(?!\s+state)", re.I)
REGIONS = {
    "nyc": lambda seg, states: bool(_NYC.search(seg)),
    "chicago": lambda seg, states: bool(re.search(r"\b(chicago|chi)\b", seg, re.I)),
    "texas": lambda seg, states: "TX" in states,
    "california": lambda seg, states: "CA" in states,
}

_SPLIT = re.compile(r"\s*(?:;|\||•|·|/|\s+or\s+|\s+and\s+|&)\s*", re.I)
_US_CASE = re.compile(r"(?<![A-Za-z])(?:US|USA|U\.S\.A?\.?)(?![A-Za-z])")
_WORDS = re.compile(r"[a-zà-ÿ][a-zà-ÿ.']*", re.I)
# Workday-style "GB-London", "CA-Ontario-Toronto", "US-CA-Menlo Park": a country code prefix.
_CODE_PREFIX = re.compile(r"^([A-Z]{2})\s?-")
_COUNTRY_CODES = set(
    "US GB UK IE JP KR CN TW HK SG IN AU NZ CA MX BR AR CL CO PE FR DE NL BE CH AT ES PT IT PL "
    "CZ RO RS HU GR UA LT LV EE SI HR BG DK SE NO FI IS LU IL TR AE SA QA EG NG KE ZA MY ID TH VN PH".split())


def _phrases(seg: str) -> list[str]:
    """Every 1-3 word run in the segment, lowercased, for set lookups."""
    words = [w.lower() if w.lower() in ("u.s.", "u.k.") else w.lower().rstrip(".")
             for w in _WORDS.findall(seg.replace("-", " "))]
    return [" ".join(words[i:i + n]) for n in (3, 2, 1) for i in range(len(words) - n + 1)]


def _country_prefix(seg: str) -> str | None:
    m = _CODE_PREFIX.match(seg)
    return m.group(1) if m and m.group(1) in _COUNTRY_CODES else None


def _explicit_us(seg: str) -> bool:
    prefix = _country_prefix(seg)
    if prefix:
        return prefix == "US"
    # Only trust the bare two-letter form when capitalised ("Remote US", not "join us").
    return bool(_US_CASE.search(seg)) or bool(re.search(r"\bunited states\b|\busa\b", seg, re.I))


def _foreign_country(seg: str, phrases: list[str]) -> bool:
    prefix = _country_prefix(seg)
    if prefix and prefix != "US":
        return True
    if _PROVINCE_CODE.search(seg) or re.search(r"\bCAN\b", seg):
        return True
    if "new mexico" in phrases:  # the state, not the country
        phrases = [p for p in phrases if p != "mexico"]
    return any(p in FOREIGN_COUNTRIES or p in CANADIAN_PROVINCES for p in phrases)


def _us_states(seg: str, phrases: list[str]) -> set[str]:
    """States named outright: "TX", "Texas", "Washington, D.C."."""
    if seg.strip().upper() == "LA":  # Los Angeles, not Louisiana
        return {"CA"}
    seg = re.sub(r"\bD\.C\.?", "DC", seg)
    found = {c for c in re.findall(r"(?<![A-Za-z])([A-Z]{2})(?![A-Za-z])", seg) if c in STATES}
    # "New York" alone is the city; it's picked up by US_CITIES instead.
    found |= {_STATE_BY_NAME[p] for p in phrases if p in _STATE_BY_NAME and p != "new york"}
    return found


def _city_states(phrases: list[str]) -> set[str]:
    return {US_CITIES[p] for p in phrases if p in US_CITIES}


def classify_segment(seg: str) -> tuple[str, frozenset[str]]:
    """→ (US | FOREIGN | UNKNOWN, US states it names or implies)."""
    seg = seg.strip(" ,-()")
    if not seg:
        return UNKNOWN, frozenset()
    phrases = _phrases(seg)
    cities = _city_states(phrases)
    if _explicit_us(seg):
        rest = _CODE_PREFIX.sub("", seg)
        return US, frozenset(_us_states(rest, _phrases(rest)) | cities)
    # "Toronto, New York, San Francisco": a comma list mixing countries. Any
    # piece that names a US city stands on its own.
    if cities and "," in seg:
        us_pieces = [classify_segment(piece) for piece in seg.split(",")]
        us_states = set().union(*(st for v, st in us_pieces if v == US))
        if any(v == US for v, _ in us_pieces):
            return US, frozenset(us_states)
    if _foreign_country(seg, phrases):
        return FOREIGN, frozenset()
    states = _us_states(seg, phrases)
    if states:
        return US, frozenset(states | cities)
    if cities:
        return US, frozenset(cities)
    if any(p in FOREIGN_CITIES for p in phrases):
        return FOREIGN, frozenset()
    return UNKNOWN, frozenset()


@dataclass(frozen=True)
class Placement:
    verdict: str          # US | FOREIGN | UNKNOWN
    preferred: bool       # at least one US location is in a preferred region


def segments(texts) -> list[str]:
    out = []
    for text in texts:
        if text:
            out += [s for s in _SPLIT.split(text) if s and s.strip(" ,-()")]
    return out


def place(texts, preferred: tuple[str, ...] = ()) -> Placement:
    verdicts, is_preferred = set(), False
    for seg in segments(texts):
        verdict, states = classify_segment(seg)
        verdicts.add(verdict)
        if verdict == US and any(REGIONS[r](seg, states) for r in preferred):
            is_preferred = True
    if US in verdicts:
        return Placement(US, is_preferred)
    if FOREIGN in verdicts:
        return Placement(FOREIGN, False)
    return Placement(UNKNOWN, False)
