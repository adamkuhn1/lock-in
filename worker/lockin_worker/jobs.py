from __future__ import annotations

import re
import statistics
import threading
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

from job_radar import details, location as loc, posted, screen, tiers
from job_radar import state as state_mod
from job_radar.config import Company, Filters, GitHubList, load_companies, load_filters, load_lists
from job_radar.notify import safe_click_url
from job_radar.radar import Source, _norm, build_sources, default_fetch

from . import clock

STATE_KEY = "jobs"
MAX_RESOLVE = 30  # posted-time lookups per run (each one is an HTTP call)
MAX_DETAILS = 60  # full-posting reads per run for new matches (PhD, years of experience, graduation window)
MAX_RESCREEN = 25  # inbox postings from before the checks existed, read per run until all are done
SCREENED_RETENTION_DAYS = 60
SEED_DAYS = 90  # a newly added company brings its matching postings from this far back (season programs stay open for months)
UNDATED_ATS = {"meta"}  # sites that never give a posting date
FAIL_ALERT_AFTER = 6  # consecutive failed runs (~3 hours at every 30 min) before a board is reported
# Every Workday board sits on *.myworkdayjobs.com, which answers HTTP 429 when one runner sends it hundreds of
# searches every 10 minutes. So Workday gets at most 2 requests in flight, each board is read every 3rd run
# (~30 min), and a 429 pauses that whole site: no more requests this run, then 30 min, doubling up to 6 hours.
THROTTLED_ATS = {"workday": 2}
ROTATE_ATS = {"workday": 3}
COOLDOWN_FIRST_MIN = 30
COOLDOWN_MAX_MIN = 360
RATE_LIMITED = re.compile(r"\bHTTP 429\b")
OPEN = ("new", "seen")
TRADING_FIRM = "Trading firm"
TITLE_RULE = "Title doesn't fit (filters.yaml)"
KEPT = "Kept by Adam"  # filtered_reason on a posting Adam restored from Filtered in the app: never refile it


def load_sources(config_dir: Path) -> tuple[list[Source], Filters]:
    companies = load_companies(config_dir / "companies.yaml")
    lists = load_lists(config_dir / "lists.yaml")
    return build_sources(companies, lists), load_filters(config_dir / "filters.yaml")


def tier_index(sources: list[Source]) -> tiers.TierIndex:
    return tiers.TierIndex([s.target for s in sources if isinstance(s.target, Company)])


def _load_state(db) -> dict:
    rows = db.select("worker_state", {"key": STATE_KEY})
    st = state_mod.empty()
    if rows:
        st.update(rows[0]["value"])
    return st


def posting_id(job) -> str:
    """The postings row id: company, title and location, so the NYC and SF openings of one role are two cards."""
    return f"{_norm(job.company)}|{_norm(job.title)}|{_norm(job.location or '')}"


# ---- the same posting from two sources ----

_TITLE_SYNONYMS = [
    (re.compile(r"\b(new|recent|university|college|new college) grad(uate)?s?\b"), "new grad"),
    (re.compile(r"\bswe\b"), "software engineer"),
    (re.compile(r"\bsde\b"), "software development engineer"),
    (re.compile(r"\bengineering\b"), "engineer"),
    (re.compile(r"\binternship\b"), "intern"),
    (re.compile(r"\bi\b"), "1"),
]
_TITLE_NOISE = {"2026", "2027", "2028", "the", "and", "of", "a", "for", "to", "in", "at", "us", "usa", "role", "position"}
_CITY_ALIASES = {"sf": "san francisco", "nyc": "new york", "new york city": "new york", "manhattan": "new york",
                 "brooklyn": "new york", "la": "los angeles", "chi": "chicago", "sea": "seattle"}
_NOT_CITIES = {"united states", "usa", "us", "u.s.", "hybrid", "onsite", "on-site", "multiple locations", "various"}
_ID_PARAMS = {"gh_jid", "jid", "id", "jobid", "job_id", "req", "reqid", "requisitionid"}


def title_key(title: str) -> str:
    """"Software Engineer, New Grad (2027)" and "New Graduate Software Engineer" compare equal."""
    s = _norm(title)
    for pat, repl in _TITLE_SYNONYMS:
        s = pat.sub(repl, s)
    return " ".join(sorted(set(s.split()) - _TITLE_NOISE))


def cities(location: str | None) -> frozenset[str]:
    out = set()
    for seg in loc.segments([location or ""]):
        city = seg.split(",")[0].strip().lower()
        city = re.sub(r"\s*\(.*?\)\s*", " ", city).strip(" -")
        if not city or city in _NOT_CITIES:
            continue
        out.add("remote" if city.startswith("remote") else _CITY_ALIASES.get(city, city))
    return frozenset(out)


def url_key(url: str | None) -> str | None:
    """The link without tracking parameters, so the same posting shared by two lists matches."""
    if not url:
        return None
    s = urlsplit(url.strip())
    if not s.netloc:
        return None
    keep = sorted((k.lower(), v) for k, v in parse_qsl(s.query) if k.lower() in _ID_PARAMS)
    return f"{s.netloc.lower().removeprefix('www.')}{s.path.rstrip('/').lower()}" + (f"?{urlencode(keep)}" if keep else "")


class SeenPostings:
    """Every posting already saved (any status): a new match that's the same job from another source is skipped,
    even if Adam already dismissed or applied to it."""

    def __init__(self, rows=()):
        self.urls: set[str] = set()
        self.roles: dict[tuple[str, str], list[frozenset[str]]] = {}
        for r in rows:
            self.add(r.get("company"), r.get("title"), r.get("location"), r.get("url"))

    def add(self, company, title, location, url) -> None:
        if (u := url_key(url)):
            self.urls.add(u)
        self.roles.setdefault((tiers.company_key(company), title_key(title or "")), []).append(cities(location))

    def has(self, company, title, location, url) -> bool:
        if (u := url_key(url)) and u in self.urls:
            return True
        here = cities(location)
        for there in self.roles.get((tiers.company_key(company), title_key(title or "")), []):
            if not here or not there or here & there:
                return True
        return False


# ---- full-posting checks ----

def _ats(src: Source) -> tuple[str | None, str | None]:
    return (src.target.ats, src.target.token) if isinstance(src.target, Company) else (None, None)


def _screen_all(items, session, describe, limit: int) -> dict[int, str]:
    """Read up to `limit` postings in parallel; {index: reason} for the ones that rule Adam out. Errors are skipped."""
    cache: dict = {}

    def one(i_item):
        i, (job, ats, token) = i_item
        try:
            return i, screen.screen(describe(job, session, cache, ats=ats, token=token))
        except Exception:  # a posting we can't read is judged on its title, like before
            return i, None

    todo = [(i, it) for i, it in enumerate(items) if details.target(it[0], it[1], it[2]) is not None][:limit]
    if not todo or session is None:
        return {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        return {i: r for i, r in pool.map(one, todo) if r}


def collect(db, sources: list[Source], filters: Filters, session, now: datetime, fetch=default_fetch,
            describe=details.fetch_text) -> dict:
    st = _load_state(db)
    today = clock.local_day(now).isoformat()
    index = tier_index(sources)
    tier_by_company = {_norm(s.label): s.tier for s in sources if not isinstance(s.target, GitHubList)}
    direct = set(tier_by_company)  # companies with their own board: their GitHub-list rows would only be duplicates

    cooling = _cooling(st, now)
    active = [s for s in sources if not _sits_out(s, cooling, now)]
    gates = {ats: threading.Semaphore(n) for ats, n in THROTTLED_ATS.items()}
    tripped: set[str] = set()  # sites that answered 429 this run: their remaining boards are skipped

    def one(src):
        ats = _ats(src)[0]
        with gates.get(ats) or nullcontext():
            if ats in tripped:
                return src, None, None
            try:
                return src, fetch(src, session, st["sources"].get(src.key, {}).get("sha")), None
            except Exception as exc:  # FetchError or a parser bug: report it and keep going
                if ats and RATE_LIMITED.search(str(exc)):
                    tripped.add(ats)
                return src, None, str(exc)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, active))

    existing = db.select("postings")
    seen_before = SeenPostings(existing)
    limited = {src.key: err for src, _, err in results if err and RATE_LIMITED.search(err)}
    errors = {src.key: err for src, _, err in results if err and src.key not in limited}
    skipped = {s.key for s in sources} - {src.key for src, fetched, err in results if fetched is not None or err}
    rate_alert = _update_cooldown(st, {_ats(src)[0] for src, _, err in results if src.key in limited},
                                  {_ats(src)[0] for src, fetched, _ in results if fetched is not None}, now)
    alert = _track_failures(st, sources, errors, now, keep=skipped | set(limited))
    current_ids: dict[str, set[str]] = {}
    to_insert, to_check, seeded, dupes, cache = [], [], 0, 0, {}
    for src, fetched, err in results:
        if err or fetched is None or fetched[0] is None:
            continue
        found, sha = fetched
        current_ids[src.key] = {j.id for j in found}
        entry = st["sources"].get(src.key)
        fresh_only = entry is None
        undated = getattr(src.target, "ats", None) in UNDATED_ATS  # no posting dates at all: bring every match
        if entry is None:
            # First run for this source: everything counts as seen, but its recent matches still reach the inbox,
            # so adding a company shows what it has open now. Lists (Simplify) stay silent: they're mostly old rows.
            entry = st["sources"][src.key] = {"seen": {}, **({"sha": sha} if sha else {})}
            seeded += 1
            if isinstance(src.target, GitHubList):
                entry["seen"] = {j.id: today for j in found}
                continue
        if sha:
            entry["sha"] = sha
        for job in found:
            if job.id in entry["seen"]:
                continue
            entry["seen"][job.id] = today
            if fresh_only and not _recent(job.posted_at, now) and not undated:
                continue
            if not src.matches(job, filters):
                continue
            if isinstance(src.target, GitHubList) and _norm(job.company) in direct:
                continue
            url = safe_click_url(job.url)
            if seen_before.has(job.company, job.title, job.location, url):
                dupes += 1
                continue
            seen_before.add(job.company, job.title, job.location, url)
            if len(to_insert) < MAX_RESOLVE:
                job = posted.resolve(job, session, cache, log=lambda *_: None)
            to_insert.append({
                "id": posting_id(job), "company": job.company, "title": job.title, "location": job.location or None,
                "url": url, "term": job.term, "posted_at": job.posted_at,
                "tier": index.tier(job.company, job.location_texts, fallback=tier_by_company.get(_norm(job.company), src.tier)),
                "starred": filters.placement(job.location_texts).preferred,
                "status": "new", "filtered_reason": None, "found_at": now.isoformat(),
            })
            to_check.append((job, *_ats(src), fresh_only))
    for i, reason in _screen_all([c[:3] for c in to_check], session, describe, MAX_DETAILS).items():
        to_insert[i].update(status="filtered", filtered_reason=reason)
    if to_insert:
        db.upsert("postings", to_insert, on_conflict="id", ignore_duplicates=True)
    refiled = _refile_open(db, existing, filters, index, st, today, session, describe)
    state_mod.prune(st, current_ids, clock.local_day(now))
    db.upsert("worker_state", [{"key": STATE_KEY, "value": st}], on_conflict="key")
    new = [r for r in to_insert if r["status"] == "new"]
    fresh = [r for r, c in zip(to_insert, to_check) if r["status"] == "new" and not c[3] and _alertable(r, now)]
    return {"new": len(new), "filtered": len(to_insert) - len(new), "dupes": dupes, "seeded": seeded,
            "refiled": refiled, "lag_min": _lag_minutes(new, now), "errors": errors, "alert": alert, "fresh": fresh,
            "rate_limited": sorted(limited), "skipped": len(skipped), "rate_alert": rate_alert}


def _refile_open(db, existing: list[dict], filters: Filters, index: tiers.TierIndex, st: dict, today: str,
                 session, describe) -> int:
    """Keep the inbox in line with today's rules: re-tier open postings, file away trading firms and titles the
    filters now reject, and read older postings in full (a few per run) for the checks new ones get."""
    screened = st.setdefault("screened", {})
    cutoff = (date.fromisoformat(today) - timedelta(days=SCREENED_RETENTION_DAYS)).isoformat()
    for k in [k for k, d in screened.items() if d < cutoff]:
        del screened[k]
    changed: dict[str, dict] = {}
    unread = []
    for p in existing:
        if p.get("status") not in OPEN:
            continue
        kept = p.get("filtered_reason") == KEPT
        row = dict(p)
        title = f"{p['title']} ({p['term']})" if p.get("term") else p["title"]
        if not kept and filters.excluded_company(p["company"]):
            row.update(status="filtered", filtered_reason=TRADING_FIRM)
        elif not kept and p.get("found_by") != "claude" and not filters.matches(title, check_include=False):
            row.update(status="filtered", filtered_reason=TITLE_RULE)
        else:
            row["tier"] = index.tier(p["company"], (p.get("location") or "",), fallback=p.get("tier"))
            if p["id"] not in screened and not kept:
                unread.append(row)
        if row != p:
            changed[p["id"]] = row
    unread = unread[:MAX_RESCREEN]
    jobs_ = [(_StoredJob(r), None, None) for r in unread]
    for i, reason in _screen_all(jobs_, session, describe, MAX_RESCREEN).items():
        changed[unread[i]["id"]] = {**unread[i], "status": "filtered", "filtered_reason": reason}
    if session is not None:
        for r in unread:
            screened[r["id"]] = today
    if changed:
        db.upsert("postings", list(changed.values()), on_conflict="id")
    return len(changed)


class _StoredJob:
    """A saved postings row, shaped enough like a Job for details.target / fetch_text (they read url and id)."""

    def __init__(self, row: dict):
        self.url, self.id = row.get("url") or "", row.get("id")


def _alertable(row: dict, now: datetime) -> bool:
    """Phone alerts are for postings that just went up: unknown post time counts, three days old doesn't."""
    if not row.get("posted_at"):
        return True
    try:
        when = datetime.fromisoformat(row["posted_at"].replace("Z", "+00:00"))
    except ValueError:
        return True
    if when.tzinfo is None:
        when = when.replace(tzinfo=now.tzinfo)
    return now - when <= timedelta(days=posted.OLD_AFTER_DAYS)


def _lag_minutes(rows: list[dict], now: datetime) -> int:
    """Median minutes from the employer publishing a posting to Lock In finding it (postings with a post time)."""
    lags = []
    for r in rows:
        try:
            when = datetime.fromisoformat(str(r.get("posted_at")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=now.tzinfo)
        if timedelta(0) <= now - when <= timedelta(days=posted.OLD_AFTER_DAYS):
            lags.append((now - when).total_seconds() / 60)
    return int(statistics.median(lags)) if lags else -1


def tier_untiered(db, index: tiers.TierIndex) -> int:
    """Outreach cards and engineer contacts saved without a tier get their company's, using the posting's location."""
    where = {p.get("url"): p.get("location") or "" for p in db.select("postings") if p.get("url")}
    n = 0
    for table, url_col in (("outreach", "job_url"), ("referrals", "job_url")):
        for r in db.select(table):
            if r.get("tier") or not r.get("company"):
                continue
            db.update(table, {"id": r["id"]}, {"tier": index.tier(r["company"], (where.get(r.get(url_col)) or "",))})
            n += 1
    return n


# ---- phone alerts for new postings (settings.job_alerts) ----

ALERT_MAX = 10  # individual pushes per run; the rest roll into one summary
_ALERT_ORDER = {tiers.REACH: 0, tiers.MIDWEST: 1, tiers.VOLUME: 2}


def alerts(rows: list[dict], app_url: str | None) -> list[tuple[str, str, str, str | None]]:
    """(title, body, priority, click) for each push: reach and Midwest postings one by one, volume in one summary."""
    rows = sorted(rows, key=lambda r: (_ALERT_ORDER.get(r.get("tier"), 3), not r.get("starred"), r["company"]))
    single = [r for r in rows if r.get("tier") in (tiers.REACH, tiers.MIDWEST)][:ALERT_MAX]
    rest = [r for r in rows if r not in single]
    out = []
    for r in single:
        where = " · ".join(x for x in (r.get("location"), r.get("term")) if x) or "Location not listed"
        label = "Reach" if r["tier"] == tiers.REACH else "Midwest"
        out.append((f"{'⭐ ' if r.get('starred') else ''}{r['company']} — {r['title']}", f"{label} · {where}",
                    "high" if r["tier"] == tiers.REACH else "default", r.get("url")))
    if rest:
        jobs_url = f"{app_url.rstrip('/')}/hunt/jobs" if app_url else None
        lines = [f"{r['company']} — {r['title']}" for r in rest[:20]]
        more = f"\n+{len(rest) - 20} more" if len(rest) > 20 else ""
        out.append((f"{len(rest)} more new postings", "\n".join(lines) + more, "low", jobs_url))
    return out


def _recent(posted_at: str | None, now: datetime) -> bool:
    try:
        when = datetime.fromisoformat((posted_at or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    if when.tzinfo is None:
        when = when.replace(tzinfo=now.tzinfo)
    return now - when <= timedelta(days=SEED_DAYS)


def _sits_out(src: Source, cooling: set[str], now: datetime) -> bool:
    """True when this board isn't read this run: its site is paused after a 429, or it's another slice's turn."""
    ats = _ats(src)[0]
    if ats in cooling:
        return True
    n = ROTATE_ATS.get(ats)
    return bool(n) and zlib.crc32(src.key.encode()) % n != ((now.hour * 60 + now.minute) // 10) % n


def _cooling(st: dict, now: datetime) -> set[str]:
    out = set()
    for ats, c in (st.get("cooldown") or {}).items():
        try:
            if datetime.fromisoformat(c["until"]) > now:
                out.add(ats)
        except (KeyError, TypeError, ValueError):
            pass
    return out


def _update_cooldown(st: dict, hit: set[str], ok: set[str], now: datetime) -> list[str]:
    """Pause each site that answered 429 (30 min, doubling to 6 h); a clean read ends the pause.

    Returns one line per site that just started a pause, for the phone alert."""
    cd = st.setdefault("cooldown", {})
    for ats in ok - hit:
        cd.pop(ats, None)
    out = []
    for ats in sorted(hit):
        prev = cd.get(ats) or {}
        mins = min(int(prev.get("minutes") or COOLDOWN_FIRST_MIN // 2) * 2, COOLDOWN_MAX_MIN)
        cd[ats] = {"until": (now + timedelta(minutes=mins)).isoformat(timespec="seconds"), "minutes": mins}
        if not prev:
            out.append(f"{ats}: too many requests (HTTP 429), paused for {mins} min")
    return out


def _track_failures(st: dict, sources: list[Source], errors: dict[str, str], now: datetime,
                    keep: set[str] = frozenset()) -> list[str]:
    """Count consecutive failures per board; return "Name: error" for boards that just reached FAIL_ALERT_AFTER.

    Each board is reported once per outage: it alerts again only after it recovers and breaks again.
    Boards in `keep` weren't really read this run (skipped or rate-limited), so their count is left as it was."""
    failing = st.setdefault("failing", {})
    for key in [k for k in failing if k not in errors and k not in keep]:
        del failing[key]
    label = {s.key: s.label for s in sources}
    out = []
    for key, err in errors.items():
        f = failing.setdefault(key, {"since": now.isoformat(timespec="seconds"), "count": 0})
        f["count"] = int(f.get("count") or 0) + 1
        f["error"] = err[:200]
        if f["count"] >= FAIL_ALERT_AFTER and not f.get("alerted"):
            f["alerted"] = True
            out.append(f"{label.get(key, key)}: {err[:120]}")
    return sorted(out)
