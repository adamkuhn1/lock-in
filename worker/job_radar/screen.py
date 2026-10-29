"""Full-posting checks the title can't answer: PhD required, 2+ years of experience, wrong graduation window.

Each check is conservative. It returns a reason only when the posting says so plainly, because a wrong "no" hides a
real job, while a wrong "yes" only costs a glance. The reasons show in Jobs under Filtered, so a mistake is visible."""

from __future__ import annotations

import re

# Adam graduates May 2027 and can move it to December 2027 (shared/profile_defaults.json: grad, grad_late).
GRAD_DATES = ((2027, 5), (2027, 12))
MIN_YEARS = 2  # a posting asking for this much full-time experience is out of reach

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10,
    "nov": 11, "dec": 12, "spring": 5, "summer": 8, "fall": 12, "autumn": 12, "winter": 12,
}
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?|spring|summer|fall|autumn|winter"
_DATE = rf"(?:(?P<m{{n}}>{_MONTH})\s*(?:of\s+)?,?\s*)?(?P<y{{n}}>20[2-3]\d)"
_RANGE = re.compile(
    rf"(?:between\s+)?{_DATE.format(n=1)}\s*(?:-|–|—|to|through|thru|until|and)\s*{_DATE.format(n=2)}", re.I)
_YEAR = re.compile(r"(?<!\d)(20[2-3]\d)(?!\d)")
_GRAD_CONTEXT = re.compile(r"graduat|class of|grad date|degree (?:by|between|in)", re.I)

_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_YEARS = re.compile(
    r"(?<![\d.])(?P<n>\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*"
    r"(?:(?:-|–|to)\s*(?:\d{1,2})\s*\+?\s*)?(?:full[- ]time\s+)?years?\b", re.I)
_SOFT = re.compile(r"prefer|nice[- ]to[- ]have|bonus|\ba plus\b|\bplus\b|ideal|desired|desirable|not required|optional", re.I)
_COUNTS_SCHOOL = re.compile(r"intern|co-?op|academic|coursework|school|universit|college|project|research experience", re.I)
_SOFT_HEADER = re.compile(r"prefer|nice[- ]to[- ]have|bonus|\ba plus\b|desired|desirable|extra credit", re.I)
_HARD_HEADER = re.compile(r"minimum|required|basic|requirement|qualifications|what you|you have|you'?ll need|must|who you are", re.I)

_PHD = re.compile(
    r"\bph\.?\s?d\.?\s+(?:degree\s+)?(?:is\s+)?required"
    r"|\b(?:must|should)\s+(?:have|hold)\s+(?:a\s+)?ph\.?\s?d"
    r"|\b(?:currently\s+)?(?:pursuing|enrolled in|completing|working towards?)\s+(?:a\s+)?ph\.?\s?d"
    r"|\bph\.?\s?d\.?\s+(?:students?|candidates?|graduates?)\b"
    r"|\b(?:completed|hold|have)\s+(?:a\s+)?ph\.?\s?d"
    r"|\bdoctor(?:ate|al)\s+(?:degree\s+)?(?:is\s+)?required", re.I)
_UNDERGRAD_OK = re.compile(r"bachelor|undergrad|\bb\.?s\.?\b|\bbsc?\b|or equivalent|prefer|\bor\s+(?:a\s+)?ph", re.I)

_SENTENCE = re.compile(r"(?<=[.!?;])\s+|\n+")


def _month(raw: str | None, default: int) -> int:
    key = (raw or "").lower().rstrip(".")
    for name, num in sorted(_MONTHS.items(), key=lambda kv: -len(kv[0])):
        if key.startswith(name):
            return num
    return default


def _covers(start: tuple[int, int], end: tuple[int, int]) -> bool:
    return any(start <= d <= end for d in GRAD_DATES)


def grad_window(text: str) -> str | None:
    """"Graduating between December 2025 and June 2026" → a reason; a window that includes May or Dec 2027 → None."""
    ranges, singles = [], set()
    for m in _GRAD_CONTEXT.finditer(text):
        window = text[max(0, m.start() - 60): m.end() + 160]
        for r in _RANGE.finditer(window):
            y1, y2 = int(r.group("y1")), int(r.group("y2"))
            start, end = (y1, _month(r.group("m1"), 1)), (y2, _month(r.group("m2"), 12))
            if start <= end:
                ranges.append((start, end, r.group(0)))
        # A bare year only counts right after the word ("graduating in 2026", "Class of 2026"), not "founded in 2012".
        singles |= {int(y) for y in _YEAR.findall(text[m.start(): m.end() + 50]) if 2024 <= int(y) <= 2030}
    if ranges:
        if any(_covers(s, e) for s, e, _ in ranges):
            return None
        return f"For {' '.join(ranges[0][2].split())} graduates"
    if singles and not any(y == d[0] for y in singles for d in GRAD_DATES):
        return f"For {'/'.join(str(y) for y in sorted(singles))} graduates"
    return None


def experience(text: str) -> str | None:
    """"3+ years of professional experience" in the requirements → a reason. Preferred or school years don't count."""
    soft_section = False
    for line in text.splitlines():
        if len(line) < 70 and not _YEARS.search(line):
            if _SOFT_HEADER.search(line):
                soft_section = True
            elif _HARD_HEADER.search(line):
                soft_section = False
            continue
        if soft_section:
            continue
        for sentence in _SENTENCE.split(line):
            if "experience" not in sentence.lower() or _SOFT.search(sentence) or _COUNTS_SCHOOL.search(sentence):
                continue
            for m in _YEARS.finditer(sentence):
                raw = m.group("n").lower()
                n = _NUMBER_WORDS.get(raw) or int(raw)
                if MIN_YEARS <= n <= 15:
                    return f"Needs {n}+ years of experience"
    return None


def phd(text: str) -> str | None:
    for sentence in _SENTENCE.split(text):
        if _PHD.search(sentence) and not _UNDERGRAD_OK.search(sentence):
            return "Needs a PhD"
    return None


def screen(text: str | None) -> str | None:
    """The first reason this posting isn't for Adam, or None."""
    if not text:
        return None
    return grad_window(text) or phd(text) or experience(text)
