# Lock In — Plan 1: Backend (database, worker, LeetCode engine, nudges)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python worker, run every 30 minutes by GitHub Actions, that syncs LeetCode, GitHub commits, the application Sheet and job boards into Supabase. It also builds each day's LeetCode set and sends ntfy nudges. When this plan is done, Adam gets real daily nudges on his phone even though the web UI (Plan 2) doesn't exist yet.

**Architecture:** A pure-Python core: the LeetCode scheduler, topic levels, daily-set builder, nudge decisions, Sheet mapping, and streaks. These are pure functions with no I/O, tested on their own. A thin I/O layer (`db.py` over Supabase PostgREST, plus one sync module per source) feeds them. `__main__.py` runs each source in isolation, records `sync_status`, then builds the plan and nudges. job-radar's package is vendored unchanged (`worker/job_radar/`) and wrapped by `lockin_worker/jobs.py`, which writes to the `postings` table instead of pushing notifications.

**Tech Stack:** Python 3.12, requests, PyYAML, google-auth, pytest; Supabase Postgres (PostgREST + RLS); GitHub Actions; ntfy.sh.

**Spec:** `docs/superpowers/specs/2026-10-14-lock-in-design.md` (read §3, §4, §6, §7, §9–§13 before starting).

**Out of this plan (Plans 2 and 3):** the web app and the `sync-leetcode` Vercel function (Plan 2). The launcher, the `lockin` CLI, outreach, `save-ideas`, and disabling job-radar's `radar.yml` (Plan 3). job-radar keeps running and pushing per-job alerts until Plan 3's cutover.

## Global Constraints

- Timezone for every "today" and every nudge: `America/Detroit`.
- **Plan day = local date of (now − 4 h)**. The LeetCode set and today's idea are generated on the first run at or after 04:00. Streaks use the calendar day of the event.
- Cron: `7,37 * * * *` (off the :00/:30 peak, the same reasoning as job-radar).
- Nudge defaults are `["10:00","18:00","22:00"]`. Each kind fires at most once per plan day.
- Ratings: `nailed` | `struggled` | `help`. An unrated solve from a previous day is treated as `struggled`.
- Review intervals for a nailed solve are `[3, 7, 21, 60, 120]` days. Parking: 3 or more lapses plus a non-nailed rating → due in 14 days.
- Daily count N: default 6, allowed range 5–8. Reviews are at most `floor(0.4*N)`.
- Premium (`paidOnly`) problems are never recommended.
- Every user table has `owner uuid not null` and RLS `owner = auth.uid()`. The worker writes with the service-role key and sets `owner` from the `LOCKIN_OWNER_ID` environment variable.
- Dates are written as ISO strings (`date.isoformat()`), and timestamps as ISO 8601 with offset.
- Commits are authored as `adamkuhn1 <184679495+adamkuhn1@users.noreply.github.com>`. This is already set in the repo-local git config and must stay that way; Vercel Hobby blocks other authors.
- Never send email or anything else on Adam's behalf. This plan's only outbound message channel is ntfy, to Adam's own topic.

## Review Focus

1. **Overlapping or duplicated cron runs** (GitHub delays one run until the next one starts). The same nudge must not send twice, and a second daily set must not be generated. Pinned by `test_nudge_not_resent_same_day` (Task 9) and `test_ensure_plan_is_idempotent` (Task 10).
2. **A late-night solve near the UTC/ET date boundary.** A solve at 23:50 ET counts toward that day, not the next one. Pinned by `test_local_day_late_night_et` (Task 1) and `test_streak_counts_late_night_solve` (Task 9).
3. **The same problem solved twice in one day, or a problem outside the bank.** The first counts once as an attempt. The second does nothing to scheduling. Problems outside the bank are stored but never scheduled. Pinned by `test_apply_pending_same_day_twice` and `test_apply_pending_non_bank` (Task 5).
4. **Sheet layout drift:** the header row moves, columns are reordered, blank rows appear, or an optional column goes missing. The sync should still map correctly by header name. Pinned by `test_map_rows_header_moved_and_reordered` and `test_map_rows_missing_optional_column` (Task 7).
5. **One source crashing** (a parser bug or an expired Google key). The other sources still sync and the failure is recorded. If Supabase itself is down, the run exits non-zero so GitHub shows red. Pinned by `test_run_isolates_source_failures` and `test_run_fails_when_db_down` (Task 10).

---

## File Structure

```
lock-in/
├── .github/workflows/
│   ├── ci.yml                      # pytest on push (Task 1)
│   └── sync.yml                    # cron worker (Task 10)
├── supabase/
│   └── migrations/0001_init.sql    # full schema + RLS (Task 2)
└── worker/
    ├── pyproject.toml
    ├── config/                     # companies.yaml, filters.yaml, lists.yaml (copied from job-radar, Task 8)
    ├── job_radar/                  # vendored job-radar package, unchanged (Task 8)
    ├── lockin_worker/
    │   ├── __init__.py
    │   ├── __main__.py             # orchestrator (Task 10)
    │   ├── clock.py                # TZ, local_day, plan_day (Task 1)
    │   ├── db.py                   # DB protocol, RestDB, MemoryDB (Task 1)
    │   ├── bank.py                 # load problems/roadmap → Problem/Topic (Task 3)
    │   ├── engine.py               # ProblemState, apply_rating (Task 3)
    │   ├── levels.py               # topic levels (Task 4)
    │   ├── daily.py                # build_daily_set (Task 6)
    │   ├── leetcode.py             # LeetCode API + store/apply/recompute (Task 5)
    │   ├── projects.py             # GitHub commits + today's idea (Task 7b)
    │   ├── sheet.py                # Sheets read + mapping (Task 7)
    │   ├── jobs.py                 # postings collector over job_radar (Task 8)
    │   ├── streaks.py              # streak + day status (Task 9)
    │   ├── nudges.py               # decide + send (Task 9)
    │   ├── plan.py                 # ensure today's set/idea, refresh done (Task 10)
    │   ├── seed.py                 # seed problems/topics/settings/projects (Task 11)
    │   └── data/problems.json, data/roadmap.json
    └── tests/
        ├── conftest.py
        ├── test_*.py
        └── job_radar/              # job-radar's own tests + fixtures, unchanged (Task 8)
```

---

### Task 1: Worker package, clock, DB layer, CI

**Files:**
- Create: `worker/pyproject.toml`, `worker/lockin_worker/__init__.py`, `worker/tests/__init__.py` (empty), `worker/lockin_worker/clock.py`, `worker/lockin_worker/db.py`, `worker/tests/conftest.py`, `worker/tests/test_clock.py`, `worker/tests/test_db.py`, `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:**
- Produces:
  - `clock.TZ`
  - `clock.local_day(ts: datetime) -> date`
  - `clock.plan_day(now: datetime) -> date`
  - `clock.from_epoch(s: int | str) -> datetime` (UTC)
  - `clock.parse_ts(s: str) -> datetime`
  - `clock.now() -> datetime`
  - `db.DB` protocol, with methods:
    - `select(table, eq=None) -> list[dict]`
    - `upsert(table, rows, on_conflict: str) -> None`
    - `insert(table, rows) -> None`
    - `update(table, eq: dict, values: dict) -> None`
    - `delete(table, eq: dict | None = None) -> None`
  - `db.RestDB(url, key, owner, session=None)`
  - `db.MemoryDB()`
  - `db.GLOBAL_TABLES = {"problems","topics"}`

- [ ] **Step 1: Scaffold the package**

`worker/pyproject.toml`:
```toml
[project]
name = "lockin-worker"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["requests>=2.32,<3", "PyYAML>=6.0,<7", "google-auth>=2.30,<3"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["lockin_worker*", "job_radar*"]

[tool.setuptools.package-data]
lockin_worker = ["data/*.json"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```
`worker/lockin_worker/__init__.py`: empty. `.gitignore`:
```
__pycache__/
*.pyc
.venv/
.env*
node_modules/
dist/
```
Create the venv: `cd worker && python3.12 -m venv .venv && .venv/bin/pip install -e '.[dev]'`

- [ ] **Step 2: Write failing clock tests**

`worker/tests/test_clock.py`:
```python
from datetime import date, datetime, timezone
from lockin_worker import clock

def test_local_day_late_night_et():
    # 03:50 UTC on Oct 15 is 23:50 EDT on Oct 14
    ts = datetime(2026, 10, 15, 3, 50, tzinfo=timezone.utc)
    assert clock.local_day(ts) == date(2026, 10, 14)

def test_plan_day_before_4am_is_previous_day():
    ts = datetime(2026, 10, 15, 3, 30, tzinfo=clock.TZ)
    assert clock.plan_day(ts) == date(2026, 10, 14)

def test_plan_day_after_4am():
    ts = datetime(2026, 10, 15, 4, 0, tzinfo=clock.TZ)
    assert clock.plan_day(ts) == date(2026, 10, 15)

def test_from_epoch_string():
    assert clock.from_epoch("1791933659") == datetime.fromtimestamp(1791933659, tz=timezone.utc)

def test_parse_ts_roundtrip():
    ts = datetime(2026, 10, 14, 9, 0, tzinfo=clock.TZ)
    assert clock.parse_ts(ts.isoformat()) == ts
    assert clock.parse_ts("2026-10-14T13:00:00Z") == datetime(2026, 10, 14, 13, tzinfo=timezone.utc)
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd worker && .venv/bin/pytest tests/test_clock.py -v`
Expected: FAIL with `ImportError: cannot import name 'clock'`

- [ ] **Step 4: Implement clock**

`worker/lockin_worker/clock.py`:
```python
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Detroit")
PLAN_DAY_START_HOUR = 4


def now() -> datetime:
    return datetime.now(tz=TZ)


def local_day(ts: datetime) -> date:
    return ts.astimezone(TZ).date()


def plan_day(now_: datetime) -> date:
    return local_day(now_ - timedelta(hours=PLAN_DAY_START_HOUR))


def from_epoch(seconds: int | str) -> datetime:
    return datetime.fromtimestamp(int(seconds), tz=timezone.utc)


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_clock.py -v` → expect 5 passed.

- [ ] **Step 6: Write failing DB tests (MemoryDB semantics + RestDB request shape)**

`worker/tests/conftest.py`:
```python
import json
import pytest
from lockin_worker.db import MemoryDB


class FakeResp:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body if body is not None else []
        self.text = json.dumps(self._body)

    def json(self):
        return self._body


class RecordingSession:
    def __init__(self, responses=None):
        self.calls = []
        self.responses = list(responses or [])

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        return self.responses.pop(0) if self.responses else FakeResp(200, [])


@pytest.fixture
def mdb():
    return MemoryDB()
```
`worker/tests/test_db.py`:
```python
import pytest
from lockin_worker.db import MemoryDB, RestDB, DBError
from tests.conftest import RecordingSession, FakeResp

def test_memory_upsert_merges_on_conflict():
    db = MemoryDB()
    db.upsert("lc_problem_state", [{"slug": "two-sum", "lapses": 0}], on_conflict="slug")
    db.upsert("lc_problem_state", [{"slug": "two-sum", "lapses": 2}], on_conflict="slug")
    assert db.select("lc_problem_state") == [{"slug": "two-sum", "lapses": 2}]

def test_memory_select_update_delete():
    db = MemoryDB()
    db.insert("ideas", [{"id": "a", "status": "todo"}, {"id": "b", "status": "done"}])
    assert [r["id"] for r in db.select("ideas", {"status": "todo"})] == ["a"]
    db.update("ideas", {"id": "a"}, {"status": "today"})
    assert db.select("ideas", {"id": "a"})[0]["status"] == "today"
    db.delete("ideas", {"status": "done"})
    assert [r["id"] for r in db.select("ideas")] == ["a"]
    db.delete("ideas")
    assert db.select("ideas") == []

def test_rest_select_adds_owner_filter():
    s = RecordingSession([FakeResp(200, [{"x": 1}])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    assert db.select("ideas", {"status": "todo"}) == [{"x": 1}]
    method, url, kw = s.calls[0]
    assert method == "GET" and url == "https://p.supabase.co/rest/v1/ideas"
    assert kw["params"] == {"select": "*", "owner": "eq.owner-1", "status": "eq.todo"}
    assert kw["headers"]["apikey"] == "key"

def test_rest_global_table_has_no_owner():
    s = RecordingSession([FakeResp(201, [])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    db.upsert("problems", [{"slug": "a"}], on_conflict="slug")
    _, _, kw = s.calls[0]
    assert kw["json"] == [{"slug": "a"}]
    assert kw["params"] == {"on_conflict": "slug"}
    assert "resolution=merge-duplicates" in kw["headers"]["Prefer"]

def test_rest_insert_sets_owner():
    s = RecordingSession([FakeResp(201, [])])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    db.insert("ideas", [{"text": "x"}])
    assert s.calls[0][2]["json"] == [{"text": "x", "owner": "owner-1"}]

def test_rest_error_raises():
    s = RecordingSession([FakeResp(500, {"message": "boom"})])
    db = RestDB("https://p.supabase.co", "key", "owner-1", session=s)
    with pytest.raises(DBError):
        db.select("ideas")
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_db.py -v` → FAIL (`ImportError`).

- [ ] **Step 8: Implement db.py**

`worker/lockin_worker/db.py`:
```python
from __future__ import annotations

import copy
from typing import Protocol

import requests

GLOBAL_TABLES = {"problems", "topics"}
TIMEOUT = 30


class DBError(Exception):
    pass


class DB(Protocol):
    def select(self, table: str, eq: dict | None = None) -> list[dict]: ...
    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None: ...
    def insert(self, table: str, rows: list[dict]) -> None: ...
    def update(self, table: str, eq: dict, values: dict) -> None: ...
    def delete(self, table: str, eq: dict | None = None) -> None: ...


def _matches(row: dict, eq: dict | None) -> bool:
    return all(row.get(k) == v for k, v in (eq or {}).items())


class MemoryDB:
    """In-memory stand-in for tests. Owner filtering is not modelled."""

    def __init__(self):
        self.tables: dict[str, list[dict]] = {}

    def _t(self, table):
        return self.tables.setdefault(table, [])

    def select(self, table, eq=None):
        return [copy.deepcopy(r) for r in self._t(table) if _matches(r, eq)]

    def insert(self, table, rows):
        self._t(table).extend(copy.deepcopy(r) for r in rows)

    def upsert(self, table, rows, on_conflict):
        keys = [k.strip() for k in on_conflict.split(",")]
        t = self._t(table)
        for row in rows:
            hit = next((r for r in t if all(r.get(k) == row.get(k) for k in keys)), None)
            if hit is None:
                t.append(copy.deepcopy(row))
            else:
                hit.update(copy.deepcopy(row))

    def update(self, table, eq, values):
        for r in self._t(table):
            if _matches(r, eq):
                r.update(copy.deepcopy(values))

    def delete(self, table, eq=None):
        self.tables[table] = [r for r in self._t(table) if not _matches(r, eq)] if eq else []


class RestDB:
    """Supabase PostgREST with the service-role key. Scopes every user table to `owner`."""

    def __init__(self, url: str, key: str, owner: str, session=None):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.key = key
        self.owner = owner
        self.session = session or requests.Session()

    def _headers(self, prefer: str | None = None) -> dict:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        return h

    def _filters(self, table: str, eq: dict | None) -> dict:
        params = {} if table in GLOBAL_TABLES else {"owner": f"eq.{self.owner}"}
        for k, v in (eq or {}).items():
            params[k] = f"eq.{v}"
        return params

    def _owned(self, table: str, rows: list[dict]) -> list[dict]:
        if table in GLOBAL_TABLES:
            return rows
        return [{**r, "owner": self.owner} for r in rows]

    def _call(self, method: str, table: str, **kw):
        resp = self.session.request(method, self.base + table, timeout=TIMEOUT, **kw)
        if resp.status_code >= 300:
            raise DBError(f"{method} {table}: HTTP {resp.status_code} {resp.text[:300]}")
        return resp

    def select(self, table, eq=None):
        params = {"select": "*", **self._filters(table, eq)}
        return self._call("GET", table, params=params, headers=self._headers()).json()

    def insert(self, table, rows):
        if rows:
            self._call("POST", table, json=self._owned(table, rows), headers=self._headers("return=minimal"))

    def upsert(self, table, rows, on_conflict):
        if not rows:
            return
        cols = on_conflict if table in GLOBAL_TABLES else f"owner,{on_conflict}"
        self._call("POST", table, json=self._owned(table, rows), params={"on_conflict": cols},
                   headers=self._headers("resolution=merge-duplicates,return=minimal"))

    def update(self, table, eq, values):
        self._call("PATCH", table, json=values, params=self._filters(table, eq),
                   headers=self._headers("return=minimal"))

    def delete(self, table, eq=None):
        self._call("DELETE", table, params=self._filters(table, eq), headers=self._headers("return=minimal"))
```
Note on `test_rest_global_table_has_no_owner`: for global tables `on_conflict` is passed through unchanged. For owned tables it is prefixed with `owner,` because every owned unique key includes `owner` (see Task 2).

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `.venv/bin/pytest -v` → expect all clock and db tests to pass.

- [ ] **Step 10: Add CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  worker:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: worker } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: pip, cache-dependency-path: worker/pyproject.toml }
      - run: pip install -e '.[dev]'
      - run: pytest -q
```

- [ ] **Step 11: Commit**

```bash
git add .gitignore .github/workflows/ci.yml worker/
git commit -m "Add worker package skeleton with clock, DB layer and CI"
```

---

### Task 2: Database schema and RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `worker/tests/test_schema.py`

**Interfaces:**
- Produces: the tables and columns every later task reads and writes, exactly as named below.

- [ ] **Step 1: Write a failing lint test that guards RLS on every owned table**

`worker/tests/test_schema.py`:
```python
import re
from pathlib import Path

SQL = (Path(__file__).parents[2] / "supabase/migrations/0001_init.sql").read_text()
GLOBAL = {"problems", "topics"}

def tables():
    return re.findall(r"create table public\.(\w+)", SQL)

def test_every_owned_table_has_owner_and_rls():
    found = tables()
    assert len(found) >= 20
    for t in found:
        assert f"alter table public.{t} enable row level security" in SQL, t
        if t not in GLOBAL:
            block = SQL.split(f"create table public.{t}")[1].split(");")[0]
            assert "owner uuid not null default auth.uid()" in block, t
            assert f"create policy {t}_owner on public.{t}" in SQL, t

def test_global_tables_are_read_only_for_users():
    for t in GLOBAL:
        assert f"create policy {t}_read on public.{t} for select to authenticated using (true)" in SQL
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_schema.py -v` → FAIL (`FileNotFoundError`).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0001_init.sql`:
```sql
-- Lock In schema. Every user table: owner = auth.uid() via RLS. Worker uses the service role.

create table public.problems (
  slug text primary key,
  lc_id int,
  title text not null,
  difficulty text not null check (difficulty in ('Easy','Medium','Hard')),
  topic text not null,
  lists text[] not null default '{}',
  lc_tags text[] not null default '{}',
  paid_only boolean not null default false,
  ac_rate real,
  target_minutes int,
  neetcode_link text
);

create table public.topics (
  name text primary key,
  ord int not null,
  tier int not null,
  prereqs text[] not null default '{}',
  lc_tags text[] not null default '{}'
);

create table public.settings (
  owner uuid not null default auth.uid() primary key,
  nudge_times text[] not null default '{10:00,18:00,22:00}',
  daily_lc_count int not null default 6 check (daily_lc_count between 5 and 8),
  weekly_app_target int not null default 25,
  ntfy_topic text,
  resume_root text not null default '~/Desktop/Adam_Kuhn_Resumes',
  sheet_id text,
  lc_username text not null default 'adamkuhn',
  lc_started_on date,
  lc_focus_topic text,
  lc_focus_since date,
  app_url text
);

create table public.lc_solves (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid(),
  slug text not null,
  title text not null,
  accepted_at timestamptz not null,
  rating text check (rating in ('nailed','struggled','help')),
  rated_at timestamptz,
  effective_rating text check (effective_rating in ('nailed','struggled','help')),
  slot text check (slot in ('new','review','mystery','spot')),
  interval_before int,
  applied_at timestamptz,
  note text,
  unique (owner, slug, accepted_at)
);

create table public.lc_problem_state (
  owner uuid not null default auth.uid(),
  slug text not null,
  state text not null check (state in ('new','learning','reviewing','retained','parked')),
  interval_days int not null default 0,
  due_on date,
  lapses int not null default 0,
  primary key (owner, slug)
);

create table public.lc_topic_state (
  owner uuid not null default auth.uid(),
  topic text not null,
  level text not null check (level in ('locked','available','learning','practicing','solid','mastered')),
  updated_at timestamptz not null default now(),
  primary key (owner, topic)
);

create table public.lc_daily_sets (
  owner uuid not null default auth.uid(),
  day date not null,
  focus text not null,
  mixed_day boolean not null default false,
  items jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner, day)
);

create table public.lc_tag_counts (
  owner uuid not null default auth.uid(),
  tag text not null,
  solved int not null,
  synced_at timestamptz not null,
  primary key (owner, tag)
);

create table public.projects (
  id text not null,
  owner uuid not null default auth.uid(),
  name text not null,
  repo text not null,
  local_path text,
  active boolean not null default true,
  primary key (owner, id)
);

create table public.commits (
  owner uuid not null default auth.uid(),
  sha text not null,
  project_id text not null,
  message text not null,
  committed_at timestamptz not null,
  primary key (owner, sha)
);

create table public.ideas (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  project_id text not null,
  text text not null,
  size text not null default 'S' check (size in ('S','M')),
  status text not null default 'todo' check (status in ('todo','today','done','dropped')),
  source text not null default 'me' check (source in ('me','claude')),
  position int not null default 0,
  today_on date,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.applications (
  id bigint generated always as identity primary key,
  owner uuid not null default auth.uid(),
  company text not null,
  role text,
  track text,
  term text,
  location text,
  status text,
  stage text not null,
  priority text,
  applied_on date,
  row_hash text not null
);

create table public.postings (
  owner uuid not null default auth.uid(),
  id text not null,
  company text not null,
  title text not null,
  location text,
  url text,
  term text,
  posted_at timestamptz,
  tier text,
  starred boolean not null default false,
  status text not null default 'new' check (status in ('new','seen','dismissed','outreach')),
  found_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.outreach (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  job_url text not null,
  company text,
  role text,
  resume_path text,
  status text not null default 'queued' check (status in ('queued','drafted','sent','replied','closed')),
  sent_on date,
  follow_up_on date,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.contacts (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  outreach_id uuid not null,
  name text not null,
  title text,
  linkedin_url text,
  email_guess text,
  email_confidence text check (email_confidence in ('verified','pattern','guess')),
  why text,
  draft_subject text,
  draft_body text,
  primary key (owner, id)
);

create table public.launch_requests (
  id uuid not null default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  kind text not null check (kind in ('outreach','suggest_ideas')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','launched','failed')),
  error text,
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

create table public.sync_status (
  owner uuid not null default auth.uid(),
  source text not null,
  last_ok_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  failing_since timestamptz,
  alerted_on date,
  primary key (owner, source)
);

create table public.worker_state (
  owner uuid not null default auth.uid(),
  key text not null,
  value jsonb not null,
  primary key (owner, key)
);

-- RLS
alter table public.problems enable row level security;
alter table public.topics enable row level security;
create policy problems_read on public.problems for select to authenticated using (true);
create policy topics_read on public.topics for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['settings','lc_solves','lc_problem_state','lc_topic_state','lc_daily_sets',
    'lc_tag_counts','projects','commits','ideas','applications','postings','outreach','contacts',
    'launch_requests','sync_status','worker_state']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid())', t || '_owner', t);
  end loop;
end $$;
```
The dynamic loop doesn't put the literal strings in the file, so the test from Step 1 would fail against it. To keep the lint test honest and the SQL readable, **replace the `do $$ … $$` block** with explicit statements, two per table:
```sql
alter table public.settings enable row level security;
create policy settings_owner on public.settings for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
```
Write that pair for each of these 16 tables, in this order: settings, lc_solves, lc_problem_state, lc_topic_state, lc_daily_sets, lc_tag_counts, projects, commits, ideas, applications, postings, outreach, contacts, launch_requests, sync_status, worker_state.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `.venv/bin/pytest tests/test_schema.py -v` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/ worker/tests/test_schema.py
git commit -m "Add Lock In schema with owner-scoped RLS"
```

---

### Task 3: Problem bank loader + per-problem scheduling

**Files:**
- Create: `worker/lockin_worker/data/problems.json`, `worker/lockin_worker/data/roadmap.json` (copied from `docs/research/`), `worker/lockin_worker/bank.py`, `worker/lockin_worker/engine.py`, `worker/tests/test_bank.py`, `worker/tests/test_engine.py`

**Interfaces:**
- Produces:
  - `bank.Problem(slug, title, difficulty, topic, lists: tuple[str,...], paid_only: bool, ac_rate: float, target_minutes: int | None, lc_id: int | None, neetcode_link: str | None)`
  - `bank.Topic(name, order: int, tier: int, prereqs: tuple[str,...], lc_tags: tuple[str,...])`
  - `bank.load_bank() -> dict[str, Problem]`
  - `bank.load_topics() -> list[Topic]` (sorted by order)
  - `engine.ProblemState(slug, state="new", interval_days=0, due_on: date | None = None, lapses=0)`
  - `engine.apply_rating(ps: ProblemState, rating: str, day: date) -> ProblemState`
  - `engine.INTERVALS`
  - `engine.RATINGS = ("nailed","struggled","help")`

- [ ] **Step 1: Copy the data**

```bash
mkdir -p worker/lockin_worker/data
cp docs/research/problems.json docs/research/roadmap.json worker/lockin_worker/data/
```

- [ ] **Step 2: Write failing bank tests**

`worker/tests/test_bank.py`:
```python
from lockin_worker.bank import load_bank, load_topics

def test_bank_loads_all_problems():
    bank = load_bank()
    assert len(bank) == 420
    ts = bank["two-sum"]
    assert ts.difficulty == "Easy" and ts.topic == "Arrays & Hashing"
    assert "nc150" in ts.lists and ts.target_minutes == 15

def test_topics_ordered_with_prereqs():
    topics = load_topics()
    assert len(topics) == 18
    assert topics[0].name == "Arrays & Hashing" and topics[0].prereqs == ()
    trees = next(t for t in topics if t.name == "Trees")
    assert set(trees.prereqs) == {"Linked List", "Binary Search"}
    assert [t.order for t in topics] == sorted(t.order for t in topics)

def test_every_problem_topic_exists():
    names = {t.name for t in load_topics()}
    assert {p.topic for p in load_bank().values()} <= names
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_bank.py -v` → FAIL (`ImportError`).

- [ ] **Step 4: Implement bank.py**

```python
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
```
Also create an empty `worker/lockin_worker/data/__init__.py` so `resources.files("lockin_worker.data")` resolves.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_bank.py -v` → 3 passed. If `two-sum` has no `grindMinutes` of 15, read the actual value from the JSON and fix the **test** (the data is the source of truth).

- [ ] **Step 6: Write failing scheduling tests**

`worker/tests/test_engine.py`:
```python
from datetime import date, timedelta
import pytest
from lockin_worker.engine import ProblemState, apply_rating

D = date(2026, 10, 14)

def test_nailed_ladder():
    p = ProblemState("a")
    seen = []
    for _ in range(6):
        p = apply_rating(p, "nailed", D)
        seen.append(p.interval_days)
    assert seen == [3, 7, 21, 60, 120, 120]
    assert p.state == "retained" and p.due_on == D + timedelta(days=120)

def test_nailed_below_60_is_reviewing():
    p = apply_rating(ProblemState("a", interval_days=7), "nailed", D)
    assert (p.state, p.interval_days) == ("reviewing", 21)

def test_help_resets_and_counts_lapse():
    p = apply_rating(ProblemState("a", state="reviewing", interval_days=21), "help", D)
    assert (p.state, p.interval_days, p.lapses, p.due_on) == ("learning", 1, 1, D + timedelta(days=1))

def test_struggled_grows_slowly_but_always_grows():
    assert apply_rating(ProblemState("a"), "struggled", D).interval_days == 1
    assert apply_rating(ProblemState("a", interval_days=1), "struggled", D).interval_days == 2
    assert apply_rating(ProblemState("a", interval_days=7), "struggled", D).interval_days == 8
    assert apply_rating(ProblemState("a", interval_days=21), "struggled", D).interval_days == 25
    assert apply_rating(ProblemState("a", interval_days=21), "struggled", D).state == "reviewing"

def test_parked_after_three_lapses():
    p = ProblemState("a", lapses=2)
    p = apply_rating(p, "help", D)
    assert (p.state, p.due_on) == ("parked", D + timedelta(days=14))

def test_nailed_unparks():
    p = apply_rating(ProblemState("a", state="parked", lapses=3, interval_days=1), "nailed", D)
    assert p.state == "reviewing" and p.interval_days == 3

def test_bad_rating():
    with pytest.raises(ValueError):
        apply_rating(ProblemState("a"), "meh", D)
```
Struggled rule (a clarification of spec §6, which says "a little sooner than nailed"): `interval = max(interval + 1, round(interval * 1.2))`, with a minimum of 1. This keeps a struggled problem from repeating at a 1-day interval forever.

- [ ] **Step 7: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_engine.py -v` → FAIL.

- [ ] **Step 8: Implement engine.py**

```python
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta

INTERVALS = (3, 7, 21, 60, 120)
RATINGS = ("nailed", "struggled", "help")
RETAINED_AT = 60
PARK_LAPSES = 3
PARK_DAYS = 14


@dataclass
class ProblemState:
    slug: str
    state: str = "new"
    interval_days: int = 0
    due_on: date | None = None
    lapses: int = 0


def apply_rating(ps: ProblemState, rating: str, day: date) -> ProblemState:
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating!r}")
    p = replace(ps)
    if rating == "help":
        p.state, p.interval_days = "learning", 1
        p.lapses += 1
    elif rating == "struggled":
        p.interval_days = max(1, p.interval_days + 1, round(p.interval_days * 1.2))
        p.state = "reviewing"
    else:
        p.interval_days = next((i for i in INTERVALS if i > p.interval_days), INTERVALS[-1])
        p.state = "retained" if p.interval_days >= RETAINED_AT else "reviewing"
    p.due_on = day + timedelta(days=p.interval_days)
    if p.lapses >= PARK_LAPSES and rating != "nailed":
        p.state = "parked"
        p.due_on = day + timedelta(days=PARK_DAYS)
    return p
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_engine.py tests/test_bank.py -v` → all pass.

- [ ] **Step 10: Commit**

```bash
git add worker/lockin_worker/data worker/lockin_worker/bank.py worker/lockin_worker/engine.py worker/tests/test_bank.py worker/tests/test_engine.py
git commit -m "Add problem bank loader and per-problem review scheduling"
```

---

### Task 4: Topic levels

**Files:**
- Create: `worker/lockin_worker/levels.py`, `worker/tests/test_levels.py`

**Interfaces:**
- Consumes: `engine.ProblemState`
- Produces:
  - `levels.LEVELS = ("locked","available","learning","practicing","solid","mastered")`
  - `levels.rank(level) -> int`
  - `levels.Attempt(slug, topic, difficulty, rating, on: date, slot="new", interval_before=0)` (frozen)
  - `levels.topic_level(*, prev: str, attempts: list[Attempt], easy_pool: int, nc150: set[str], states: dict[str, ProblemState], prereq_levels: list[str], today: date) -> str`

`available` is an addition to the spec's list. It means "unlocked but not started". Without it, the UI would have to label an untouched topic as "Learning".

- [ ] **Step 1: Write failing tests**

`worker/tests/test_levels.py`:
```python
from datetime import date, timedelta
from lockin_worker.engine import ProblemState
from lockin_worker.levels import Attempt, topic_level

T = date(2026, 11, 30)
TOPIC = "Sliding Window"

def a(slug, diff, rating, days_ago=1, slot="new", ib=0):
    return Attempt(slug, TOPIC, diff, rating, T - timedelta(days=days_ago), slot, ib)

def lvl(attempts, prev="learning", prereqs=("practicing",), states=None, nc150=None, easy_pool=6):
    return topic_level(prev=prev, attempts=attempts, easy_pool=easy_pool, nc150=nc150 or set(),
                       states=states or {}, prereq_levels=list(prereqs), today=T)

def test_locked_vs_available_without_attempts():
    assert lvl([], prereqs=("learning",)) == "locked"
    assert lvl([], prereqs=("practicing",)) == "available"
    assert lvl([], prereqs=()) == "available"

def test_attempt_overrides_lock():
    assert lvl([a("e1", "Easy", "help")], prereqs=("locked",)) == "learning"

def test_practicing():
    att = [a("e1","Easy","nailed"), a("e2","Easy","struggled"), a("e3","Easy","nailed"),
           a("m1","Medium","nailed"), a("m2","Medium","struggled")]
    assert lvl(att) == "practicing"

def test_practicing_with_small_easy_pool():
    att = [a("e1","Easy","nailed"), a("m1","Medium","nailed"), a("m2","Medium","nailed")]
    assert lvl(att, easy_pool=1) == "practicing"

def _solid_attempts():
    att = [a(f"e{i}","Easy","nailed", 40) for i in range(3)]
    att += [a(f"m{i}","Medium","nailed", 30 - i) for i in range(6)]
    att += [a(f"m{i}","Medium","nailed", 10 - i, ib=7) for i in range(3)]  # spaced re-solves
    return att

def test_solid():
    assert lvl(_solid_attempts()) == "solid"

def test_not_solid_without_spaced_resolves():
    att = [a(f"e{i}","Easy","nailed") for i in range(3)] + [a(f"m{i}","Medium","nailed") for i in range(6)]
    assert lvl(att) == "practicing"

def test_solid_hysteresis():
    att = _solid_attempts() + [a("m7","Medium","struggled", 1), a("m8","Medium","struggled", 0)]
    assert lvl(att, prev="practicing") == "practicing"   # 3/5 recent: not enough to reach solid
    assert lvl(att, prev="solid") == "solid"             # but enough to stay solid

def test_mastered():
    att = _solid_attempts() + [a("h1","Hard","struggled", 2),
          a("x1","Medium","nailed", 3, slot="mystery"), a("x2","Medium","nailed", 2, slot="mystery")]
    nc = {"m0", "m1", "m2", "m3"}
    states = {s: ProblemState(s, "reviewing", 21) for s in ["m0", "m1", "m2"]}
    assert lvl(att, nc150=nc, states=states) == "mastered"
    states.pop("m2")  # only 2/4 = 50% at 21d+
    assert lvl(att, nc150=nc, states=states) == "solid"

def test_mastered_decays_on_lapses():
    att = _solid_attempts() + [a("m1","Medium","help", 3), a("m2","Medium","help", 2)]
    assert lvl(att, prev="mastered") != "mastered"

def test_mastered_decays_without_recent_nailed():
    att = [x for x in _solid_attempts()]
    old = [Attempt(x.slug, x.topic, x.difficulty, x.rating, x.on - timedelta(days=60), x.slot, x.interval_before) for x in att]
    assert lvl(old, prev="mastered") != "mastered"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_levels.py -v` → FAIL.

- [ ] **Step 3: Implement levels.py**

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .engine import ProblemState

LEVELS = ("locked", "available", "learning", "practicing", "solid", "mastered")
UNAIDED = {"nailed", "struggled"}


def rank(level: str) -> int:
    return LEVELS.index(level)


@dataclass(frozen=True)
class Attempt:
    slug: str
    topic: str
    difficulty: str
    rating: str
    on: date
    slot: str = "new"
    interval_before: int = 0


def _distinct(attempts, diff, ratings, **extra) -> set[str]:
    return {x.slug for x in attempts if x.difficulty == diff and x.rating in ratings
            and all(getattr(x, k) == v for k, v in extra.items())}


def topic_level(*, prev: str, attempts: list[Attempt], easy_pool: int, nc150: set[str],
                states: dict[str, ProblemState], prereq_levels: list[str], today: date) -> str:
    if not attempts:
        blocked = any(rank(p) < rank("practicing") for p in prereq_levels)
        return "locked" if blocked else "available"

    attempts = sorted(attempts, key=lambda x: x.on)
    easy_ok = len(_distinct(attempts, "Easy", UNAIDED)) >= min(3, max(easy_pool, 0))
    med_ok = len(_distinct(attempts, "Medium", UNAIDED)) >= 2
    if not (easy_ok and med_ok):
        return "learning"

    meds = [x for x in attempts if x.difficulty == "Medium"]
    last5 = meds[-5:]
    nailed5 = sum(x.rating == "nailed" for x in last5)
    was_solid = rank(prev) >= rank("solid")
    recent_ok = len(last5) == 5 and nailed5 >= (3 if was_solid else 4)
    spaced = {x.slug for x in meds if x.rating == "nailed" and x.interval_before >= 7}
    solid = len(_distinct(attempts, "Medium", {"nailed"})) >= 6 and len(spaced) >= 3 and recent_ok
    if not solid:
        return "practicing"

    if prev == "mastered":
        lapses30 = sum(1 for x in attempts if x.rating == "help" and (today - x.on).days <= 30)
        nailed45 = any(x.rating == "nailed" and (today - x.on).days <= 45 for x in attempts)
        return "mastered" if lapses30 < 2 and nailed45 else "solid"

    hard_ok = bool(_distinct(attempts, "Hard", UNAIDED))
    mystery = _distinct(attempts, "Medium", {"nailed"}, slot="mystery")
    if nc150:
        held = sum(1 for s in nc150 if s in states and states[s].interval_days >= 21)
        retained_ok = held / len(nc150) >= 0.75
    else:
        retained_ok = True
    return "mastered" if hard_ok and len(mystery) >= 2 and retained_ok else "solid"
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_levels.py -v` → all pass. If `test_mastered_decays_on_lapses` fails because the help attempts also break the 4-of-5 rule, the expectation `!= "mastered"` still holds; don't loosen it.

- [ ] **Step 5: Commit**

```bash
git add worker/lockin_worker/levels.py worker/tests/test_levels.py
git commit -m "Add topic mastery levels with hysteresis and decay"
```

---

### Task 5: LeetCode sync, applying ratings, recomputing levels

**Files:**
- Create: `worker/lockin_worker/leetcode.py`, `worker/tests/test_leetcode.py`, `worker/tests/fixtures/lc_recent.json`, `worker/tests/fixtures/lc_tags.json`

**Interfaces:**
- Consumes:
  - `db.DB`, `clock.*`, `bank.load_bank/load_topics`
  - `engine.apply_rating/ProblemState`
  - `levels.topic_level/Attempt`
- Produces:
  - `leetcode.fetch_recent(session, username) -> list[dict]` with keys `slug, title, accepted_at` (ISO UTC)
  - `leetcode.fetch_tag_counts(session, username) -> dict[str, int]`
  - `leetcode.store_solves(db, solves) -> int` (new rows only)
  - `leetcode.store_tag_counts(db, counts, now) -> None`
  - `leetcode.load_states(db) -> dict[str, ProblemState]`
  - `leetcode.apply_pending(db, bank, today: date, now: datetime) -> int`
  - `leetcode.load_attempts(db, bank) -> list[Attempt]`
  - `leetcode.recompute_levels(db, bank, topics, today) -> dict[str, str]`
  - `leetcode.sync(db, session, username, now) -> dict` (summary)

- [ ] **Step 1: Record fixtures**

`worker/tests/fixtures/lc_recent.json`:
```json
{"data":{"recentAcSubmissionList":[
 {"title":"Daily Temperatures","titleSlug":"daily-temperatures","timestamp":"1791933317"},
 {"title":"Two Sum","titleSlug":"two-sum","timestamp":"1791830000"}
]}}
```
`worker/tests/fixtures/lc_tags.json`:
```json
{"data":{"matchedUser":{"tagProblemCounts":{
 "advanced":[{"tagSlug":"union-find","problemsSolved":3}],
 "intermediate":[{"tagSlug":"hash-table","problemsSolved":8}],
 "fundamental":[{"tagSlug":"array","problemsSolved":20}]}}}}
```

- [ ] **Step 2: Write failing tests**

`worker/tests/test_leetcode.py`:
```python
import json
from datetime import date, datetime, timezone
from pathlib import Path
from lockin_worker import leetcode
from lockin_worker.bank import load_bank, load_topics
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

FX = Path(__file__).parent / "fixtures"

class GqlSession:
    def __init__(self, *bodies):
        self.bodies = list(bodies); self.posts = []
    def post(self, url, json=None, headers=None, timeout=None):
        self.posts.append(json)
        body = self.bodies.pop(0)
        class R:
            status_code = 200
            def json(self_): return body
        return R()

def fx(name): return json.loads((FX / name).read_text())

def test_fetch_recent_parses():
    s = GqlSession(fx("lc_recent.json"))
    out = leetcode.fetch_recent(s, "adamkuhn")
    assert out[0] == {"slug": "daily-temperatures", "title": "Daily Temperatures",
                      "accepted_at": datetime.fromtimestamp(1791933317, tz=timezone.utc).isoformat()}
    assert s.posts[0]["variables"] == {"u": "adamkuhn"}

def test_fetch_tag_counts_flattens():
    s = GqlSession(fx("lc_tags.json"))
    assert leetcode.fetch_tag_counts(s, "adamkuhn") == {"union-find": 3, "hash-table": 8, "array": 20}

def test_store_solves_dedupes():
    db = MemoryDB()
    rows = [{"slug": "two-sum", "title": "Two Sum", "accepted_at": "2026-10-14T13:00:00+00:00"}]
    assert leetcode.store_solves(db, rows) == 1
    assert leetcode.store_solves(db, rows) == 0
    assert len(db.select("lc_solves")) == 1

def _solve(db, slug, ts, rating=None):
    db.insert("lc_solves", [{"slug": slug, "title": slug, "accepted_at": ts, "rating": rating}])

def test_apply_pending_rated_today():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-14T14:00:00+00:00", "nailed")
    n = leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ))
    assert n == 1
    st = db.select("lc_problem_state")[0]
    assert (st["slug"], st["state"], st["interval_days"], st["due_on"]) == ("two-sum", "reviewing", 3, "2026-10-17")
    s = db.select("lc_solves")[0]
    assert s["effective_rating"] == "nailed" and s["interval_before"] == 0 and s["applied_at"]

def test_apply_pending_unrated_waits_until_next_day():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-14T14:00:00+00:00")
    assert leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ)) == 0
    assert leetcode.apply_pending(db, bank, date(2026, 10, 15), datetime(2026, 10, 15, 12, tzinfo=TZ)) == 1
    assert db.select("lc_solves")[0]["effective_rating"] == "struggled"

def test_apply_pending_same_day_twice():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "two-sum", "2026-10-14T14:00:00+00:00", "help")
    _solve(db, "two-sum", "2026-10-14T15:00:00+00:00", "nailed")
    leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 23, tzinfo=TZ))
    st = db.select("lc_problem_state")[0]
    assert (st["state"], st["lapses"]) == ("learning", 1)
    second = [s for s in db.select("lc_solves") if s["accepted_at"].startswith("2026-10-14T15")][0]
    assert second["applied_at"] and second.get("effective_rating") is None

def test_apply_pending_non_bank():
    db, bank = MemoryDB(), load_bank()
    _solve(db, "fizz-buzz-not-in-bank", "2026-10-13T14:00:00+00:00")
    leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ))
    assert db.select("lc_problem_state") == []
    assert db.select("lc_solves")[0]["applied_at"]

def test_apply_pending_takes_slot_from_daily_set():
    db, bank = MemoryDB(), load_bank()
    db.insert("lc_daily_sets", [{"day": "2026-10-14", "focus": "Stack", "mixed_day": False,
                                 "items": [{"slug": "daily-temperatures", "slot": "mystery", "order": 0, "done": False}]}])
    _solve(db, "daily-temperatures", "2026-10-14T14:00:00+00:00", "nailed")
    leetcode.apply_pending(db, bank, date(2026, 10, 14), datetime(2026, 10, 14, 12, tzinfo=TZ))
    assert db.select("lc_solves")[0]["slot"] == "mystery"

def test_recompute_levels_writes_all_topics():
    db, bank = MemoryDB(), load_bank()
    levels = leetcode.recompute_levels(db, bank, load_topics(), date(2026, 10, 14))
    assert levels["Arrays & Hashing"] == "available"
    assert levels["Trees"] == "locked"
    assert len(db.select("lc_topic_state")) == 18
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_leetcode.py -v` → FAIL.

- [ ] **Step 4: Implement leetcode.py**

```python
from __future__ import annotations

from datetime import date, datetime

from . import clock
from .bank import Problem, Topic
from .engine import ProblemState, apply_rating
from .levels import Attempt, topic_level

GQL = "https://leetcode.com/graphql"
HEADERS = {"Content-Type": "application/json", "Referer": "https://leetcode.com"}
RECENT_Q = "query($u:String!){recentAcSubmissionList(username:$u,limit:20){title titleSlug timestamp}}"
TAGS_Q = ("query($u:String!){matchedUser(username:$u){tagProblemCounts{"
          "advanced{tagSlug problemsSolved} intermediate{tagSlug problemsSolved} "
          "fundamental{tagSlug problemsSolved}}}}")


class LeetCodeError(Exception):
    pass


def _gql(session, query: str, username: str) -> dict:
    resp = session.post(GQL, json={"query": query, "variables": {"u": username}}, headers=HEADERS, timeout=30)
    if resp.status_code != 200:
        raise LeetCodeError(f"HTTP {resp.status_code}")
    body = resp.json()
    if body.get("errors") or not body.get("data"):
        raise LeetCodeError(f"GraphQL error: {body.get('errors')}")
    return body["data"]


def fetch_recent(session, username: str) -> list[dict]:
    rows = _gql(session, RECENT_Q, username)["recentAcSubmissionList"] or []
    return [{"slug": r["titleSlug"], "title": r["title"],
             "accepted_at": clock.from_epoch(r["timestamp"]).isoformat()} for r in rows]


def fetch_tag_counts(session, username: str) -> dict[str, int]:
    user = _gql(session, TAGS_Q, username)["matchedUser"]
    if not user:
        raise LeetCodeError(f"unknown LeetCode user {username!r}")
    out = {}
    for group in user["tagProblemCounts"].values():
        for t in group or []:
            out[t["tagSlug"]] = int(t["problemsSolved"])
    return out


def _ts_key(ts: str) -> datetime:
    return clock.parse_ts(ts)


def store_solves(db, solves: list[dict]) -> int:
    existing = {(s["slug"], _ts_key(s["accepted_at"])) for s in db.select("lc_solves")}
    new = [s for s in solves if (s["slug"], _ts_key(s["accepted_at"])) not in existing]
    if new:
        db.insert("lc_solves", [{**s, "rating": None} for s in new])
    return len(new)


def store_tag_counts(db, counts: dict[str, int], now: datetime) -> None:
    db.upsert("lc_tag_counts", [{"tag": t, "solved": n, "synced_at": now.isoformat()} for t, n in counts.items()],
              on_conflict="tag")


def load_states(db) -> dict[str, ProblemState]:
    out = {}
    for r in db.select("lc_problem_state"):
        due = date.fromisoformat(r["due_on"]) if r.get("due_on") else None
        out[r["slug"]] = ProblemState(r["slug"], r["state"], int(r["interval_days"]), due, int(r["lapses"]))
    return out


def _slots_by_day(db) -> dict[str, dict[str, str]]:
    return {s["day"]: {i["slug"]: i["slot"] for i in s["items"]} for s in db.select("lc_daily_sets")}


def apply_pending(db, bank: dict[str, Problem], today: date, now: datetime) -> int:
    solves = sorted(db.select("lc_solves"), key=lambda s: _ts_key(s["accepted_at"]))
    states = load_states(db)
    slots = _slots_by_day(db)
    done_keys = {(s["slug"], clock.local_day(_ts_key(s["accepted_at"])))
                 for s in solves if s.get("applied_at") and s.get("effective_rating")}
    applied = 0
    for s in solves:
        if s.get("applied_at"):
            continue
        day = clock.local_day(_ts_key(s["accepted_at"]))
        match = {"slug": s["slug"], "accepted_at": s["accepted_at"]}
        if s["slug"] not in bank or (s["slug"], day) in done_keys:
            db.update("lc_solves", match, {"applied_at": now.isoformat()})
            continue
        if not s.get("rating") and day >= today:
            continue  # give Adam the rest of the day to rate it
        rating = s.get("rating") or "struggled"
        before = states.get(s["slug"], ProblemState(s["slug"]))
        after = apply_rating(before, rating, day)
        states[s["slug"]] = after
        db.upsert("lc_problem_state", [{"slug": after.slug, "state": after.state,
                                        "interval_days": after.interval_days,
                                        "due_on": after.due_on.isoformat() if after.due_on else None,
                                        "lapses": after.lapses}], on_conflict="slug")
        slot = slots.get(day.isoformat(), {}).get(s["slug"], "new")
        db.update("lc_solves", match, {"applied_at": now.isoformat(), "effective_rating": rating,
                                       "interval_before": before.interval_days, "slot": slot})
        done_keys.add((s["slug"], day))
        applied += 1
    return applied


def load_attempts(db, bank: dict[str, Problem]) -> list[Attempt]:
    out = []
    for s in db.select("lc_solves"):
        p = bank.get(s["slug"])
        if p and s.get("effective_rating"):
            out.append(Attempt(p.slug, p.topic, p.difficulty, s["effective_rating"],
                               clock.local_day(_ts_key(s["accepted_at"])), s.get("slot") or "new",
                               int(s.get("interval_before") or 0)))
    return out


def recompute_levels(db, bank, topics: list[Topic], today: date) -> dict[str, str]:
    attempts = load_attempts(db, bank)
    states = load_states(db)
    prev = {r["topic"]: r["level"] for r in db.select("lc_topic_state")}
    result: dict[str, str] = {}
    for t in topics:  # roadmap order puts prerequisites first
        in_topic = [x for x in attempts if x.topic == t.name]
        pool = [p for p in bank.values() if p.topic == t.name and not p.paid_only]
        result[t.name] = topic_level(
            prev=prev.get(t.name, "locked"), attempts=in_topic,
            easy_pool=sum(p.difficulty == "Easy" for p in pool),
            nc150={p.slug for p in pool if "nc150" in p.lists},
            states=states, prereq_levels=[result.get(x, "locked") for x in t.prereqs], today=today)
    db.upsert("lc_topic_state", [{"topic": k, "level": v, "updated_at": clock.now().isoformat()}
                                 for k, v in result.items()], on_conflict="topic")
    return result


def sync(db, session, username: str, now: datetime) -> dict:
    added = store_solves(db, fetch_recent(session, username))
    store_tag_counts(db, fetch_tag_counts(session, username), now)
    return {"new_solves": added}
```
`MemoryDB.update` matches on exact values. Tests pass the same `accepted_at` string they inserted, and `RestDB` sends `accepted_at=eq.<iso>`, which PostgREST compares as a timestamptz. Both work.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_leetcode.py -v` → all pass. Also check that `test_recompute_levels_writes_all_topics` holds with real roadmap data: Trees is `locked` because its prereqs are `locked`/`available`.

- [ ] **Step 6: Commit**

```bash
git add worker/lockin_worker/leetcode.py worker/tests/test_leetcode.py worker/tests/fixtures/lc_*.json
git commit -m "Add LeetCode sync, rating application and level recompute"
```

---

### Task 6: Daily set builder

**Files:**
- Create: `worker/lockin_worker/daily.py`, `worker/tests/test_daily.py`

**Interfaces:**
- Consumes: `bank.Problem/Topic`, `engine.ProblemState`, `levels.rank`
- Produces:
  - `daily.Item(slug: str, slot: str)` (frozen; slot ∈ `review|new|mystery|spot`)
  - `daily.DailyInput(today, day_index, n, focus, focus_since, levels: dict[str,str], states: dict[str,ProblemState], attempted: frozenset[str], lifetime_mediums: int)`
  - `daily.DailyPlan(items: list[Item], focus: str, focus_since: date, mixed_day: bool)`
  - `daily.choose_focus(inp, topics) -> tuple[str, date]`
  - `daily.build_daily_set(inp, bank, topics) -> DailyPlan`

Focus rule, clarifying spec §6: once the current focus has had 10 days, the next eligible topic **other than the current one** becomes focus if one exists. This keeps Adam from being stuck on one topic for weeks while it climbs to Solid. Its reviews keep coming through the review queue.

- [ ] **Step 1: Write failing tests**

`worker/tests/test_daily.py`:
```python
from datetime import date, timedelta
from lockin_worker.bank import Problem, Topic
from lockin_worker.daily import DailyInput, build_daily_set, choose_focus
from lockin_worker.engine import ProblemState

T = date(2026, 10, 20)
TOPICS = [Topic("A", 1, 0, (), ()), Topic("B", 2, 1, ("A",), ()), Topic("C", 3, 1, ("A",), ())]

def P(slug, diff, topic, lists=("nc150",), ac=50.0, paid=False):
    return Problem(slug, slug, diff, topic, lists, paid, ac, None)

def bank():
    out = {}
    for t in "ABC":
        for d, k in (("Easy", 4), ("Medium", 8), ("Hard", 3)):
            for i in range(k):
                p = P(f"{t}-{d[0]}{i}", d, t, ac=90 - i)
                out[p.slug] = p
    out["A-paid"] = P("A-paid", "Easy", "A", ac=99, paid=True)
    return out

def inp(**kw):
    base = dict(today=T, day_index=1, n=6, focus="A", focus_since=T, levels={"A": "learning", "B": "locked", "C": "locked"},
                states={}, attempted=frozenset(), lifetime_mediums=0)
    base.update(kw)
    return DailyInput(**base)

def test_learning_day_shape_and_order():
    plan = build_daily_set(inp(), bank(), TOPICS)
    diffs = [bank()[i.slug].difficulty for i in plan.items]
    assert len(plan.items) == 6
    assert diffs == sorted(diffs, key=["Easy", "Medium", "Hard"].index)
    assert all(bank()[i.slug].topic == "A" for i in plan.items)
    assert "A-paid" not in {i.slug for i in plan.items}
    assert plan.items[0].slug == "A-E0"  # nc150 first, then highest acRate
    assert not plan.mixed_day

def test_no_hard_before_30_mediums():
    plan = build_daily_set(inp(levels={"A": "solid", "B": "practicing", "C": "available"}, focus="B"), bank(), TOPICS)
    assert all(bank()[i.slug].difficulty != "Hard" for i in plan.items)

def test_reviews_capped_at_40_percent_and_first():
    states = {f"A-M{i}": ProblemState(f"A-M{i}", "reviewing", 3, T - timedelta(days=1)) for i in range(5)}
    plan = build_daily_set(inp(states=states, attempted=frozenset(states)), bank(), TOPICS)
    slots = [i.slot for i in plan.items]
    assert slots.count("review") == 2 and slots[:2] == ["review", "review"]

def test_mystery_slot_from_older_topic():
    levels = {"A": "practicing", "B": "practicing", "C": "available"}
    plan = build_daily_set(inp(levels=levels, focus="B"), bank(), TOPICS)
    myst = [i for i in plan.items if i.slot == "mystery"]
    assert len(myst) == 1 and bank()[myst[0].slug].topic != "B"
    assert bank()[myst[0].slug].difficulty == "Medium"

def test_mixed_day_every_7th():
    levels = {"A": "practicing", "B": "practicing", "C": "available"}
    plan = build_daily_set(inp(levels=levels, focus="B", day_index=6), bank(), TOPICS)
    assert plan.mixed_day and len(plan.items) == 6
    assert {i.slot for i in plan.items} <= {"mystery", "review"}

def test_focus_rotates_after_10_days():
    levels = {"A": "practicing", "B": "available", "C": "available"}
    f, since = choose_focus(inp(levels=levels, focus="A", focus_since=T - timedelta(days=10)), TOPICS)
    assert (f, since) == ("B", T)

def test_focus_kept_within_10_days():
    levels = {"A": "practicing", "B": "available", "C": "available"}
    f, since = choose_focus(inp(levels=levels, focus="A", focus_since=T - timedelta(days=3)), TOPICS)
    assert (f, since) == ("A", T - timedelta(days=3))

def test_topic_without_easy_falls_back_to_medium():
    b = {k: v for k, v in bank().items() if not (v.topic == "A" and v.difficulty == "Easy")}
    plan = build_daily_set(inp(), b, TOPICS)
    assert len(plan.items) == 6 and all(b[i.slug].difficulty in ("Medium", "Hard") for i in plan.items)

def test_weekly_spot_check_of_retained():
    states = {"A-M0": ProblemState("A-M0", "retained", 60, T + timedelta(days=30))}
    plan = build_daily_set(inp(day_index=3, states=states, attempted=frozenset(states)), bank(), TOPICS)
    assert (plan.items[0].slug, plan.items[0].slot) == ("A-M0", "spot")

def test_attempted_never_new():
    plan = build_daily_set(inp(attempted=frozenset({"A-E0", "A-E1"})), bank(), TOPICS)
    assert not {"A-E0", "A-E1"} & {i.slug for i in plan.items if i.slot == "new"}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_daily.py -v` → FAIL.

- [ ] **Step 3: Implement daily.py**

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .bank import Problem, Topic
from .engine import ProblemState
from .levels import rank

DIFFS = ("Easy", "Medium", "Hard")
FOCUS_DAYS = 10
HARD_AFTER_MEDIUMS = 30
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


def choose_focus(inp: DailyInput, topics: list[Topic]) -> tuple[str, date]:
    eligible = [t.name for t in topics
                if rank(_lvl(inp, t.name)) < rank("solid")
                and all(rank(_lvl(inp, p)) >= rank("practicing") for p in t.prereqs)]
    cur = inp.focus
    if cur and rank(_lvl(inp, cur)) < rank("solid"):
        fresh = inp.focus_since is not None and (inp.today - inp.focus_since).days < FOCUS_DAYS
        others = [t for t in eligible if t != cur]
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
    focus, since = choose_focus(inp, topics)
    practicing = [t for t in topics if rank(_lvl(inp, t.name)) >= rank("practicing")]
    taken: set[str] = set()

    if inp.day_index % 7 == 6 and len(practicing) >= 2:
        due = _due(inp, bank, focus)
        r = min(len(due), round(0.6 * inp.n))
        reviews = [Item(s.slug, "review") for s in due[:r]]
        taken |= {i.slug for i in reviews}
        rest = _mystery(inp, bank, topics, None, inp.n - r, taken)
        return DailyPlan(reviews + rest, focus, since, True)

    spot = _spot(inp, bank)
    taken |= {i.slug for i in spot}
    due = [s for s in _due(inp, bank, focus) if s.slug not in taken]
    r_budget = max(0, int(0.4 * inp.n) - len(spot))
    reviews = [Item(s.slug, "review") for s in due[:r_budget]]
    taken |= {i.slug for i in reviews}

    mystery = _mystery(inp, bank, topics, focus, 1, taken) if len(practicing) >= 2 else []
    k = inp.n - len(spot) - len(reviews) - len(mystery)

    news: list[Item] = []
    for diff in _ladder(_lvl(inp, focus), k, inp.lifetime_mediums):
        for alt in (diff, "Medium", "Hard", "Easy"):
            cands = _unseen(inp, bank, focus, alt, taken)
            if cands:
                news.append(Item(cands[0].slug, "new"))
                taken.add(cands[0].slug)
                break
    news.sort(key=lambda it: DIFFS.index(bank[it.slug].difficulty))

    # mystery goes right after the first medium
    if mystery:
        idx = next((i + 1 for i, it in enumerate(news) if bank[it.slug].difficulty == "Medium"), len(news))
        news = news[:idx] + mystery + news[idx:]
    return DailyPlan(spot + reviews + news, focus, since, False)
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_daily.py -v` → all pass.

- [ ] **Step 5: Run a sanity check against the real bank (no assertion, just eyeball the output)**

```bash
.venv/bin/python -c "
from datetime import date
from lockin_worker.bank import load_bank, load_topics
from lockin_worker.daily import DailyInput, build_daily_set
plan = build_daily_set(DailyInput(date.today(), 1, 6, None, None, {}, {}, frozenset(), 0), load_bank(), load_topics())
print(plan.focus, [(i.slug, i.slot) for i in plan.items])"
```
Expected: focus `Arrays & Hashing` and 6 items, easiest first, all free.

- [ ] **Step 6: Commit**

```bash
git add worker/lockin_worker/daily.py worker/tests/test_daily.py
git commit -m "Add daily LeetCode set builder"
```

---

### Task 7: Application Sheet sync

**Files:**
- Create: `worker/lockin_worker/sheet.py`, `worker/tests/test_sheet.py`

**Interfaces:**
- Produces:
  - `sheet.status_stage(status: str | None) -> str`, one of `applied|oa|interview|offer|closed|other`
  - `sheet.map_rows(values: list[list[str]]) -> list[dict]`, with keys `company, role, track, term, location, status, stage, priority, applied_on, row_hash`
  - `sheet.fetch_values(session, sheet_id, sa_info: dict) -> list[list[str]]`
  - `sheet.sync(db, session, sheet_id, sa_info) -> dict`
  - `sheet.STAGE_RULES` (shown in Settings in Plan 2)

- [ ] **Step 1: Write failing tests**

`worker/tests/test_sheet.py`:
```python
from lockin_worker import sheet
from lockin_worker.db import MemoryDB

HEADER = ["Company", "Role / title", "Track", "Start / term", "Location", "Status", "Priority", "Applied date"]
TITLE = [["Adam Kuhn - Application Tracker"], ["Records logged", "80", "OAs pending", "0"], [], []]

def test_status_stage():
    assert sheet.status_stage("Submitted - verify latest") == "applied"
    assert sheet.status_stage("OA invited") == "oa"
    assert sheet.status_stage("Interview - R1") == "interview"
    assert sheet.status_stage("Superday") == "interview"
    assert sheet.status_stage("Offer received") == "offer"
    assert sheet.status_stage("Rejected") == "closed"
    assert sheet.status_stage("") == "other" and sheet.status_stage(None) == "other"

def test_map_rows_real_layout():
    values = TITLE + [HEADER, ["Greenboard", "Software Engineer - 2027 Grads", "New grad", "2027", "", "Submitted - verify latest", "Unranked", "10/7/2026"]]
    rows = sheet.map_rows(values)
    assert rows == [{"company": "Greenboard", "role": "Software Engineer - 2027 Grads", "track": "New grad",
                     "term": "2027", "location": None, "status": "Submitted - verify latest", "stage": "applied",
                     "priority": "Unranked", "applied_on": "2026-10-07", "row_hash": rows[0]["row_hash"]}]
    assert len(rows[0]["row_hash"]) == 40

def test_map_rows_header_moved_and_reordered():
    hdr = ["Status", "Company", "Applied date", "Role / title"]
    values = [[], hdr, ["OA invited", "Edgehog Trading", "2026-10-01", "SWE"], [], ["", "", "", ""]]
    rows = sheet.map_rows(values)
    assert len(rows) == 1
    assert (rows[0]["company"], rows[0]["stage"], rows[0]["applied_on"], rows[0]["role"]) == ("Edgehog Trading", "oa", "2026-10-01", "SWE")

def test_map_rows_missing_optional_column():
    values = [["Company", "Status"], ["Apple", "Rejected"]]
    r = sheet.map_rows(values)[0]
    assert r["priority"] is None and r["applied_on"] is None and r["stage"] == "closed"

def test_map_rows_short_row_and_bad_date():
    values = [HEADER, ["Visa", "SWE intern"], ["Tesla", "x", "", "", "", "Submitted", "", "sometime"]]
    rows = sheet.map_rows(values)
    assert rows[0]["status"] is None and rows[1]["applied_on"] is None

def test_map_rows_no_header_raises():
    import pytest
    with pytest.raises(sheet.SheetError):
        sheet.map_rows([["foo", "bar"], ["a", "b"]])

def test_sync_replaces_table(monkeypatch):
    db = MemoryDB()
    db.insert("applications", [{"company": "Old", "stage": "applied", "row_hash": "x"}])
    monkeypatch.setattr(sheet, "fetch_values", lambda *a: [HEADER, ["New", "r", "", "", "", "OA invited", "", ""]])
    assert sheet.sync(db, None, "sid", {}) == {"rows": 1}
    assert [r["company"] for r in db.select("applications")] == ["New"]
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_sheet.py -v` → FAIL.

- [ ] **Step 3: Implement sheet.py**

```python
from __future__ import annotations

import hashlib
import re
from datetime import datetime

SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{rng}"
RANGE = "Applications!A1:Z2000"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
COLUMNS = {
    "company": "company", "role / title": "role", "role": "role", "track": "track",
    "start / term": "term", "term": "term", "location": "location", "status": "status",
    "priority": "priority", "applied date": "applied_on", "applied": "applied_on",
}
# (regex on lowercased status, stage); first match wins. Shown in Settings.
STAGE_RULES = [
    (r"^offer", "offer"),
    (r"reject|withdr|declin|closed|ghost|no response", "closed"),
    (r"interview|^r\d|round|onsite|superday|final|phone|screen", "interview"),
    (r"^oa|assessment|hackerrank|codesignal", "oa"),
    (r"submit|applied|^apply", "applied"),
]
DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%b %d, %Y", "%B %d, %Y")


class SheetError(Exception):
    pass


def _norm(s: str) -> str:
    return " ".join(str(s).strip().lower().split())


def status_stage(status: str | None) -> str:
    s = _norm(status or "")
    if not s:
        return "other"
    for pattern, stage in STAGE_RULES:
        if re.search(pattern, s):
            return stage
    return "other"


def _date(s: str | None) -> str | None:
    s = (s or "").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def map_rows(values: list[list[str]]) -> list[dict]:
    header_i = next((i for i, row in enumerate(values)
                     if {"company", "status"} <= {_norm(c) for c in row}), None)
    if header_i is None:
        raise SheetError("no header row with 'Company' and 'Status' in the Applications tab")
    cols = {}
    for j, cell in enumerate(values[header_i]):
        key = COLUMNS.get(_norm(cell))
        if key and key not in cols:
            cols[key] = j
    out = []
    for row in values[header_i + 1:]:
        get = lambda k: (row[cols[k]].strip() or None) if k in cols and cols[k] < len(row) else None
        company = get("company")
        if not company:
            continue
        rec = {k: get(k) for k in ("company", "role", "track", "term", "location", "status", "priority")}
        rec["applied_on"] = _date(get("applied_on"))
        rec["stage"] = status_stage(rec["status"])
        rec["row_hash"] = hashlib.sha1("\x1f".join(str(c) for c in row).encode()).hexdigest()
        out.append(rec)
    return out


def fetch_values(session, sheet_id: str, sa_info: dict) -> list[list[str]]:
    from google.auth.transport.requests import Request
    from google.oauth2.service_account import Credentials

    creds = Credentials.from_service_account_info(sa_info, scopes=SCOPES)
    creds.refresh(Request())
    resp = session.get(SHEETS_URL.format(id=sheet_id, rng=RANGE),
                       headers={"Authorization": f"Bearer {creds.token}"}, timeout=30)
    if resp.status_code != 200:
        raise SheetError(f"Sheets API HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.json().get("values", [])


def sync(db, session, sheet_id: str, sa_info: dict) -> dict:
    rows = map_rows(fetch_values(session, sheet_id, sa_info))
    db.delete("applications")
    db.insert("applications", rows)
    return {"rows": len(rows)}
```
Field order in the `test_map_rows_real_layout` dict doesn't matter, because dict equality ignores order.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_sheet.py -v` → all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/lockin_worker/sheet.py worker/tests/test_sheet.py
git commit -m "Add read-only application Sheet sync"
```

---

### Task 7b: Project commits + today's idea

**Files:**
- Create: `worker/lockin_worker/projects.py`, `worker/tests/test_projects.py`

**Interfaces:**
- Produces:
  - `projects.fetch_commits(session, repo, since_iso, token) -> list[dict]` with keys `sha, message, committed_at`
  - `projects.sync(db, session, token, now) -> dict`
  - `projects.pick_today_idea(db, day: date) -> dict | None`
  - `projects.complete_idea_on_commit(db, day: date, now) -> bool`

- [ ] **Step 1: Write failing tests**

`worker/tests/test_projects.py`:
```python
from datetime import date, datetime
from lockin_worker import projects
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

class S:
    def __init__(self, body, status=200): self.body, self.status, self.calls = body, status, []
    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append((url, params, headers))
        body, status = self.body, self.status
        class R:
            status_code = status
            text = "x"
            def json(self_): return body
        return R()

GH = [{"sha": "abc", "commit": {"message": "Add Chicago\n\nbody", "author": {"date": "2026-10-14T18:00:00Z"}}}]

def test_fetch_commits():
    s = S(GH)
    out = projects.fetch_commits(s, "adamkuhn1/27b", "2026-10-01T00:00:00+00:00", "tok")
    assert out == [{"sha": "abc", "message": "Add Chicago", "committed_at": "2026-10-14T18:00:00Z"}]
    url, params, headers = s.calls[0]
    assert url == "https://api.github.com/repos/adamkuhn1/27b/commits"
    assert params["since"] == "2026-10-01T00:00:00+00:00" and headers["Authorization"] == "Bearer tok"

def _db():
    db = MemoryDB()
    db.insert("projects", [{"id": "27b", "name": "27B", "repo": "adamkuhn1/27b", "active": True},
                           {"id": "showboat", "name": "Showboat", "repo": "adamkuhn1/showboat", "active": True}])
    return db

def test_sync_stores_commits_per_project(monkeypatch):
    db = _db()
    monkeypatch.setattr(projects, "fetch_commits", lambda s, repo, since, tok: [
        {"sha": repo[-3:], "message": "m", "committed_at": "2026-10-14T18:00:00Z"}])
    assert projects.sync(db, None, "tok", datetime(2026, 10, 14, 20, tzinfo=TZ)) == {"commits": 2}
    assert {c["project_id"] for c in db.select("commits")} == {"27b", "showboat"}

def test_pick_today_idea_rotates_to_stalest_project():
    db = _db()
    db.insert("commits", [{"sha": "1", "project_id": "27b", "message": "m", "committed_at": "2026-10-13T12:00:00Z"}])
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "todo", "position": 0},
                        {"id": "i2", "project_id": "showboat", "text": "b", "status": "todo", "position": 0}])
    idea = projects.pick_today_idea(db, date(2026, 10, 14))
    assert idea["id"] == "i2"  # showboat has no commits → stalest
    assert db.select("ideas", {"id": "i2"})[0]["status"] == "today"

def test_pick_today_idea_resets_stale_today():
    db = _db()
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "today", "today_on": "2026-10-13", "position": 0}])
    projects.pick_today_idea(db, date(2026, 10, 14))
    row = db.select("ideas", {"id": "i1"})[0]
    assert row["status"] == "today" and row["today_on"] == "2026-10-14"

def test_pick_today_idea_none_when_no_ideas():
    assert projects.pick_today_idea(_db(), date(2026, 10, 14)) is None

def test_commit_completes_today_idea():
    db = _db()
    db.insert("ideas", [{"id": "i1", "project_id": "27b", "text": "a", "status": "today", "today_on": "2026-10-14", "position": 0}])
    db.insert("commits", [{"sha": "1", "project_id": "27b", "message": "m", "committed_at": "2026-10-14T23:30:00Z"}])
    assert projects.complete_idea_on_commit(db, date(2026, 10, 14), datetime(2026, 10, 14, 20, tzinfo=TZ))
    assert db.select("ideas", {"id": "i1"})[0]["status"] == "done"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_projects.py -v` → FAIL.

- [ ] **Step 3: Implement projects.py**

```python
from __future__ import annotations

from datetime import date, datetime, timedelta

from . import clock

API = "https://api.github.com/repos/{repo}/commits"
LOOKBACK_DAYS = 30


class GitHubError(Exception):
    pass


def fetch_commits(session, repo: str, since_iso: str, token: str | None) -> list[dict]:
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = session.get(API.format(repo=repo), params={"since": since_iso, "per_page": 100},
                       headers=headers, timeout=30)
    if resp.status_code != 200:
        raise GitHubError(f"{repo}: HTTP {resp.status_code} {resp.text[:200]}")
    return [{"sha": c["sha"], "message": c["commit"]["message"].splitlines()[0],
             "committed_at": c["commit"]["author"]["date"]} for c in resp.json()]


def sync(db, session, token: str | None, now: datetime) -> dict:
    since = (now - timedelta(days=LOOKBACK_DAYS)).isoformat()
    total = 0
    for p in db.select("projects", {"active": True}):
        rows = [{**c, "project_id": p["id"]} for c in fetch_commits(session, p["repo"], since, token)]
        db.upsert("commits", rows, on_conflict="sha")
        total += len(rows)
    return {"commits": total}


def _last_commit(db, project_id: str) -> datetime | None:
    times = [clock.parse_ts(c["committed_at"]) for c in db.select("commits", {"project_id": project_id})]
    return max(times) if times else None


def pick_today_idea(db, day: date) -> dict | None:
    for stale in db.select("ideas", {"status": "today"}):
        if stale.get("today_on") == day.isoformat():
            return stale
    current = db.select("ideas", {"status": "today"})
    if current:  # yesterday's idea wasn't finished: carry it over to today
        db.update("ideas", {"id": current[0]["id"]}, {"today_on": day.isoformat()})
        return {**current[0], "today_on": day.isoformat()}
    active = db.select("projects", {"active": True})
    epoch = datetime.min.replace(tzinfo=clock.TZ)
    for p in sorted(active, key=lambda p: (_last_commit(db, p["id"]) or epoch, p["id"])):
        todo = sorted(db.select("ideas", {"project_id": p["id"], "status": "todo"}),
                      key=lambda i: (i.get("position", 0), str(i.get("created_at", ""))))
        if todo:
            db.update("ideas", {"id": todo[0]["id"]}, {"status": "today", "today_on": day.isoformat()})
            return {**todo[0], "status": "today", "today_on": day.isoformat()}
    return None


def complete_idea_on_commit(db, day: date, now: datetime) -> bool:
    for idea in db.select("ideas", {"status": "today"}):
        commits = db.select("commits", {"project_id": idea["project_id"]})
        if any(clock.local_day(clock.parse_ts(c["committed_at"])) == day for c in commits):
            db.update("ideas", {"id": idea["id"]}, {"status": "done", "done_at": now.isoformat()})
            return True
    return False
```
`test_commit_completes_today_idea` uses `2026-10-14T23:30:00Z`, which is 19:30 ET on Oct 14. That's the same local day.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_projects.py -v` → all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/lockin_worker/projects.py worker/tests/test_projects.py
git commit -m "Add project commit sync and daily idea rotation"
```

---

### Task 8: Jobs: vendor job-radar, collect into postings

**Files:**
- Create: `worker/job_radar/` (copied), `worker/config/*.yaml` (copied), `worker/tests/job_radar/` (copied tests and fixtures), `worker/lockin_worker/jobs.py`, `worker/tests/test_jobs.py`

**Interfaces:**
- Consumes: `job_radar.config.load_companies/load_lists/load_filters`, `job_radar.radar.build_sources/default_fetch/fingerprint/Source`, `job_radar.posted.resolve`, `job_radar.state.empty/prune`
- Produces:
  - `jobs.load_sources(config_dir: Path) -> tuple[list[Source], Filters]`
  - `jobs.collect(db, sources, filters, session, now, fetch=default_fetch) -> dict` with keys `new, seeded, errors: dict[str,str]`

- [ ] **Step 1: Vendor the package and tests without changes**

```bash
cp -R ~/Developer/job-radar/job_radar worker/job_radar
rm -rf worker/job_radar/__pycache__
mkdir -p worker/config worker/tests/job_radar
cp ~/Developer/job-radar/config/*.yaml worker/config/
cp -R ~/Developer/job-radar/tests/. worker/tests/job_radar/
rm -rf worker/tests/job_radar/__pycache__
```

- [ ] **Step 2: Run the vendored tests**

Run: `.venv/bin/pytest tests/job_radar -q`
Expected: all pass, the same count as in job-radar. The vendored tests import their helpers relatively (`from .conftest import …`), so they resolve to `tests/job_radar/conftest.py`, and they import `job_radar` as a top-level package, which `pyproject` includes.

- [ ] **Step 3: Write failing collector tests**

`worker/tests/test_jobs.py`:
```python
import re
from datetime import datetime
from pathlib import Path
from job_radar.config import Company, Filters, LocationRules
from job_radar.models import FetchError, Job
from job_radar.radar import build_sources
from lockin_worker import jobs
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

NOW = datetime(2026, 10, 14, 12, tzinfo=TZ)
FILTERS = Filters(include=re.compile("intern|new grad", re.I), exclude=re.compile("senior", re.I),
                  location=LocationRules())

def J(i, title="Software Engineer Intern", company="Stripe"):
    return Job(company, title, "New York, NY", f"https://x/{i}", None, str(i))

def sources():
    return build_sources([Company("Stripe", "greenhouse", "stripe", "A"), Company("Ramp", "ashby", "ramp", "A")], [])

def fake(board):
    def fetch(src, session, prev_sha):
        v = board[src.key]
        if isinstance(v, Exception):
            raise v
        return v, None
    return fetch

def test_first_run_seeds_silently():
    db = MemoryDB()
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake({"greenhouse:stripe": [J(1)], "ashby:ramp": []}))
    assert out["new"] == 0 and db.select("postings") == []

def test_second_run_inserts_matching_new_only():
    db = MemoryDB()
    board = {"greenhouse:stripe": [J(1)], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board["greenhouse:stripe"] = [J(1), J(2), J(3, title="Senior Engineer Intern")]
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    rows = db.select("postings")
    assert out["new"] == 1 and [r["title"] for r in rows] == ["Software Engineer Intern"]
    assert rows[0]["status"] == "new" and rows[0]["tier"] == "A"

def test_same_posting_two_sources_once():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board = {"greenhouse:stripe": [J(5)], "ashby:ramp": [J(9, company="Stripe")]}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert len(db.select("postings")) == 1

def test_source_error_reported_others_continue():
    db = MemoryDB()
    board = {"greenhouse:stripe": [], "ashby:ramp": []}
    jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    board = {"greenhouse:stripe": FetchError("HTTP 404"), "ashby:ramp": [J(7, company="Ramp")]}
    out = jobs.collect(db, sources(), FILTERS, None, NOW, fetch=fake(board))
    assert out["errors"] == {"greenhouse:stripe": "HTTP 404"} and out["new"] == 1

def test_load_sources_from_vendored_config():
    srcs, filters = jobs.load_sources(Path(__file__).parents[1] / "config")
    assert len(srcs) > 20 and filters.include.pattern
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_jobs.py -v` → FAIL.

- [ ] **Step 5: Implement jobs.py**

```python
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

from job_radar import posted
from job_radar import state as state_mod
from job_radar.config import Filters, load_companies, load_filters, load_lists
from job_radar.radar import Source, _norm, build_sources, default_fetch, fingerprint

from . import clock

STATE_KEY = "jobs"
MAX_RESOLVE = 30  # posted-time lookups per run (each one is an HTTP call)


def load_sources(config_dir: Path) -> tuple[list[Source], Filters]:
    companies = load_companies(config_dir / "companies.yaml")
    lists = load_lists(config_dir / "lists.yaml")
    return build_sources(companies, lists), load_filters(config_dir / "filters.yaml")


def _load_state(db) -> dict:
    rows = db.select("worker_state", {"key": STATE_KEY})
    st = state_mod.empty()
    if rows:
        st.update(rows[0]["value"])
    return st


def collect(db, sources: list[Source], filters: Filters, session, now: datetime, fetch=default_fetch) -> dict:
    st = _load_state(db)
    today = clock.local_day(now).isoformat()
    tier_by_company = {_norm(s.label): s.tier for s in sources if not hasattr(s.target, "repo")}

    def one(src):
        try:
            return src, fetch(src, session, st["sources"].get(src.key, {}).get("sha")), None
        except Exception as exc:  # FetchError or a parser bug: report it and keep going
            return src, None, str(exc)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, sources))

    errors = {src.key: err for src, _, err in results if err}
    current_ids: dict[str, set[str]] = {}
    known = {r["id"] for r in db.select("postings")}
    to_insert, seeded, cache = [], 0, {}
    for src, fetched, err in results:
        if err or fetched[0] is None:
            continue
        found, sha = fetched
        current_ids[src.key] = {j.id for j in found}
        entry = st["sources"].get(src.key)
        if entry is None:
            st["sources"][src.key] = {"seen": {j.id: today for j in found}, **({"sha": sha} if sha else {})}
            seeded += 1
            continue
        if sha:
            entry["sha"] = sha
        for job in found:
            if job.id in entry["seen"]:
                continue
            entry["seen"][job.id] = today
            if not src.matches(job, filters):
                continue
            fp = fingerprint(job)
            if fp in known:
                continue
            known.add(fp)
            if len(to_insert) < MAX_RESOLVE:
                job = posted.resolve(job, session, cache, log=lambda *_: None)
            to_insert.append({
                "id": fp, "company": job.company, "title": job.title, "location": job.location or None,
                "url": job.url or None, "term": job.term, "posted_at": job.posted_at,
                "tier": tier_by_company.get(_norm(job.company), src.tier),
                "starred": filters.placement(job.location_texts).preferred,
                "status": "new", "found_at": now.isoformat(),
            })
    if to_insert:
        db.upsert("postings", to_insert, on_conflict="id")
    state_mod.prune(st, current_ids, clock.local_day(now))
    db.upsert("worker_state", [{"key": STATE_KEY, "value": st}], on_conflict="key")
    return {"new": len(to_insert), "seeded": seeded, "errors": errors}
```
`posted.resolve` already returns the job unchanged when `session is None` or the URL isn't a Greenhouse/Lever/Ashby link, so tests need no network.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_jobs.py tests/job_radar -q` → all pass.

- [ ] **Step 7: Commit**

```bash
git add worker/job_radar worker/config worker/tests/job_radar worker/lockin_worker/jobs.py worker/tests/test_jobs.py
git commit -m "Move job-radar into the worker and collect postings into Supabase"
```

---

### Task 9: Streaks, day status, nudges

**Files:**
- Create: `worker/lockin_worker/streaks.py`, `worker/lockin_worker/nudges.py`, `worker/tests/test_streaks.py`, `worker/tests/test_nudges.py`

**Interfaces:**
- Produces:
  - `streaks.streak(days: set[date], today: date) -> int`
  - `streaks.DayStatus(lc_done: int, lc_total: int, focus: str | None, reviews: int, mixed_day: bool, project_done: bool, idea_text: str | None, new_postings: int, starred_postings: int, followups_due: int, lc_streak: int, project_streak: int)`
  - `streaks.day_status(db, now) -> DayStatus`
  - `nudges.Nudge(kind, title, body, priority="default", click=None)`
  - `nudges.decide(now, times: list[str], st: DayStatus, sent: set[str]) -> list[Nudge]`
  - `nudges.health(sync_rows: list[dict], now, today) -> list[tuple[str, Nudge]]`
  - `nudges.send(session, topic, nudge) -> None`
  - `nudges.run(db, session, now, topic, app_url, times: list[str]) -> list[str]` (the kinds sent)

- [ ] **Step 1: Write failing tests**

`worker/tests/test_streaks.py`:
```python
from datetime import date, datetime, timedelta
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB
from lockin_worker.streaks import day_status, streak

D = date(2026, 10, 14)

def test_streak_counts_back_from_today_or_yesterday():
    assert streak({D, D - timedelta(1), D - timedelta(2)}, D) == 3
    assert streak({D - timedelta(1), D - timedelta(2)}, D) == 2   # today not done yet: still alive
    assert streak({D - timedelta(2)}, D) == 0
    assert streak(set(), D) == 0

def test_streak_counts_late_night_solve():
    db = MemoryDB()
    db.insert("lc_solves", [{"slug": "a", "title": "a", "accepted_at": "2026-10-14T03:50:00+00:00"}])  # 23:50 ET Oct 13
    st = day_status(db, datetime(2026, 10, 14, 9, tzinfo=TZ))
    assert st.lc_streak == 1

def test_day_status_counts():
    db = MemoryDB()
    db.insert("lc_daily_sets", [{"day": "2026-10-14", "focus": "Stack", "mixed_day": False,
              "items": [{"slug": "a", "slot": "review", "order": 0, "done": True},
                        {"slug": "b", "slot": "new", "order": 1, "done": False}]}])
    db.insert("postings", [{"id": "1", "status": "new", "starred": True}, {"id": "2", "status": "new", "starred": False},
                           {"id": "3", "status": "seen", "starred": True}])
    db.insert("outreach", [{"id": "o", "status": "sent", "follow_up_on": "2026-10-14"},
                           {"id": "p", "status": "replied", "follow_up_on": "2026-10-10"}])
    db.insert("ideas", [{"id": "i", "project_id": "27b", "text": "Add Chicago", "status": "today", "today_on": "2026-10-14"}])
    st = day_status(db, datetime(2026, 10, 14, 10, tzinfo=TZ))
    assert (st.lc_done, st.lc_total, st.focus, st.reviews) == (1, 2, "Stack", 1)
    assert (st.new_postings, st.starred_postings, st.followups_due) == (2, 1, 1)
    assert st.idea_text == "Add Chicago" and st.project_done is False
```
`worker/tests/test_nudges.py`:
```python
from datetime import date, datetime
from lockin_worker.clock import TZ
from lockin_worker.nudges import decide, health
from lockin_worker.streaks import DayStatus

TIMES = ["10:00", "18:00", "22:00"]

def S(**kw):
    base = dict(lc_done=0, lc_total=6, focus="Sliding Window", reviews=1, mixed_day=False, project_done=False,
                idea_text="Add Chicago", new_postings=9, starred_postings=2, followups_due=1, lc_streak=6, project_streak=2)
    base.update(kw)
    return DayStatus(**base)

def at(h, m=0): return datetime(2026, 10, 14, h, m, tzinfo=TZ)

def test_nothing_before_first_slot():
    assert decide(at(9, 40), TIMES, S(), set()) == []

def test_plan_message():
    [n] = decide(at(10, 7), TIMES, S(), set())
    assert n.kind == "plan"
    assert n.body == "Sliding Window · 6 problems (1 review) · 9 new postings (2⭐) · 1 follow-up"

def test_plan_message_mixed_day_hides_topic():
    [n] = decide(at(10, 7), TIMES, S(mixed_day=True), set())
    assert n.body.startswith("Mixed day · 6 problems")

def test_nudge_not_resent_same_day():
    assert decide(at(10, 37), TIMES, S(), {"plan"}) == []

def test_evening_only_if_something_open():
    [n] = decide(at(18, 7), TIMES, S(lc_done=2, followups_due=0), {"plan"})
    assert (n.kind, n.body) == ("check", "Still open: LeetCode 2/6 · project")
    assert decide(at(18, 7), TIMES, S(lc_done=6, project_done=True, followups_due=0), {"plan"}) == []

def test_risk_only_when_streak_at_risk():
    [n] = decide(at(22, 7), TIMES, S(lc_done=0), {"plan", "check"})
    assert n.kind == "risk" and "LeetCode streak (6 days)" in n.body and n.priority == "high"
    assert decide(at(22, 7), TIMES, S(lc_done=1, project_done=True), {"plan", "check"}) == []
    assert decide(at(22, 7), TIMES, S(lc_done=0, lc_streak=0, project_streak=0), {"plan", "check"}) == []

def test_late_run_sends_only_latest_due_slot():
    kinds = [n.kind for n in decide(at(22, 30), TIMES, S(), set())]
    assert kinds == ["risk"]   # don't spam three nudges after an outage

def test_health_alerts_once_after_24h():
    now = at(12)
    rows = [{"source": "sheet", "consecutive_failures": 50, "failing_since": "2026-10-13T11:00:00-04:00",
             "last_error": "HTTP 403", "alerted_on": None},
            {"source": "leetcode", "consecutive_failures": 2, "failing_since": "2026-10-14T11:00:00-04:00",
             "last_error": "x", "alerted_on": None},
            {"source": "jobs", "consecutive_failures": 60, "failing_since": "2026-10-12T11:00:00-04:00",
             "last_error": "x", "alerted_on": "2026-10-14"}]
    out = health(rows, now, date(2026, 10, 14))
    assert [s for s, _ in out] == ["sheet"] and out[0][1].priority == "low"
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `.venv/bin/pytest tests/test_streaks.py tests/test_nudges.py -v` → FAIL.

- [ ] **Step 3: Implement streaks.py**

```python
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from . import clock


def streak(days: set[date], today: date) -> int:
    cur = today if today in days else today - timedelta(days=1)
    n = 0
    while cur in days:
        n += 1
        cur -= timedelta(days=1)
    return n


@dataclass(frozen=True)
class DayStatus:
    lc_done: int
    lc_total: int
    focus: str | None
    reviews: int
    mixed_day: bool
    project_done: bool
    idea_text: str | None
    new_postings: int
    starred_postings: int
    followups_due: int
    lc_streak: int
    project_streak: int


def day_status(db, now: datetime) -> DayStatus:
    today = clock.local_day(now)
    pday = clock.plan_day(now).isoformat()
    sets = db.select("lc_daily_sets", {"day": pday})
    items = sets[0]["items"] if sets else []
    lc_days = {clock.local_day(clock.parse_ts(s["accepted_at"])) for s in db.select("lc_solves")}
    commit_days = {clock.local_day(clock.parse_ts(c["committed_at"])) for c in db.select("commits")}
    postings = db.select("postings", {"status": "new"})
    due = [o for o in db.select("outreach", {"status": "sent"})
           if o.get("follow_up_on") and o["follow_up_on"] <= today.isoformat()]
    idea = next((i for i in db.select("ideas", {"status": "today"}) if i.get("today_on") == pday), None)
    return DayStatus(
        lc_done=sum(1 for i in items if i.get("done")), lc_total=len(items),
        focus=sets[0]["focus"] if sets else None,
        reviews=sum(1 for i in items if i["slot"] in ("review", "spot")),
        mixed_day=bool(sets and sets[0].get("mixed_day")),
        project_done=today in commit_days, idea_text=idea["text"] if idea else None,
        new_postings=len(postings), starred_postings=sum(1 for p in postings if p.get("starred")),
        followups_due=len(due), lc_streak=streak(lc_days, today), project_streak=streak(commit_days, today),
    )
```

- [ ] **Step 4: Implement nudges.py**

```python
from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from . import clock
from .streaks import DayStatus, day_status

NTFY = "https://ntfy.sh/{topic}"
KINDS = ("plan", "check", "risk")
STATE_KEY = "nudges"
HEALTH_AFTER = timedelta(hours=24)


@dataclass(frozen=True)
class Nudge:
    kind: str
    title: str
    body: str
    priority: str = "default"
    click: str | None = None


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _plan(st: DayStatus) -> Nudge:
    head = "Mixed day" if st.mixed_day else (st.focus or "LeetCode")
    parts = [f"{head} · {st.lc_total} problems ({_plural(st.reviews, 'review')})"]
    if st.new_postings:
        star = f" ({st.starred_postings}⭐)" if st.starred_postings else ""
        parts.append(f"{st.new_postings} new postings{star}")
    if st.followups_due:
        parts.append(_plural(st.followups_due, "follow-up"))
    return Nudge("plan", "Today's plan", " · ".join(parts))


def _open_items(st: DayStatus) -> list[str]:
    out = []
    if st.lc_total and st.lc_done < st.lc_total:
        out.append(f"LeetCode {st.lc_done}/{st.lc_total}")
    if not st.project_done:
        out.append("project")
    if st.followups_due:
        out.append(_plural(st.followups_due, "follow-up"))
    return out


def decide(now: datetime, times: list[str], st: DayStatus, sent: set[str]) -> list[Nudge]:
    local = now.astimezone(clock.TZ)
    due = [k for k, t in zip(KINDS, times) if local.time() >= time.fromisoformat(t)]
    if not due:
        return []
    kind = due[-1]  # after an outage, only the most recent slot matters
    if kind in sent:
        return []
    if kind == "plan":
        return [_plan(st)]
    if kind == "check":
        items = _open_items(st)
        return [Nudge("check", "Still open", "Still open: " + " · ".join(items))] if items else []
    risks = []
    if st.lc_streak and st.lc_done == 0:
        risks.append(f"LeetCode streak ({st.lc_streak} days)")
    if st.project_streak and not st.project_done:
        risks.append(f"project streak ({st.project_streak} days)")
    if not risks:
        return []
    return [Nudge("risk", "Streak at risk", " and ".join(risks) + " ends at midnight", priority="high")]


def health(rows: list[dict], now: datetime, today: date) -> list[tuple[str, Nudge]]:
    out = []
    for r in rows:
        since = r.get("failing_since")
        if not since or r.get("alerted_on") == today.isoformat():
            continue
        if now - clock.parse_ts(since) >= HEALTH_AFTER:
            out.append((r["source"], Nudge("health", f"Lock In: {r['source']} sync failing",
                                           f"Failing since {since[:16]}: {(r.get('last_error') or '')[:200]}",
                                           priority="low")))
    return out


def _header(v: str) -> str:
    v = " ".join(v.split())
    try:
        v.encode("ascii")
        return v
    except UnicodeEncodeError:
        return "=?UTF-8?B?" + base64.b64encode(v.encode()).decode() + "?="


def send(session, topic: str, n: Nudge) -> None:
    headers = {"Title": _header(n.title), "Priority": n.priority}
    if n.click:
        headers["Click"] = n.click
    resp = session.post(NTFY.format(topic=topic), data=n.body.encode("utf-8"), headers=headers, timeout=15)
    if resp.status_code >= 300:
        raise RuntimeError(f"ntfy HTTP {resp.status_code}")


def run(db, session, now: datetime, topic: str, app_url: str | None, times: list[str]) -> list[str]:
    pday = clock.plan_day(now).isoformat()
    rows = db.select("worker_state", {"key": STATE_KEY})
    log = rows[0]["value"] if rows else {}
    sent_today = set(log.get(pday, []))
    out = []
    for n in decide(now, times, day_status(db, now), sent_today):
        send(session, topic, Nudge(n.kind, n.title, n.body, n.priority, app_url))
        sent_today.add(n.kind)
        out.append(n.kind)
    for source, n in health(db.select("sync_status"), now, clock.local_day(now)):
        send(session, topic, n)
        db.update("sync_status", {"source": source}, {"alerted_on": clock.local_day(now).isoformat()})
        out.append(f"health:{source}")
    db.upsert("worker_state", [{"key": STATE_KEY, "value": {pday: sorted(sent_today)}}], on_conflict="key")
    return out
```
The 10:00 plan nudge fires on the plan day, which starts at 04:00, so it always follows set generation.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `.venv/bin/pytest tests/test_streaks.py tests/test_nudges.py -v` → all pass.

- [ ] **Step 6: Commit**

```bash
git add worker/lockin_worker/streaks.py worker/lockin_worker/nudges.py worker/tests/test_streaks.py worker/tests/test_nudges.py
git commit -m "Add streaks, day status and ntfy nudge decisions"
```

---

### Task 10: Plan glue, orchestrator, cron workflow

**Files:**
- Create: `worker/lockin_worker/plan.py`, `worker/lockin_worker/__main__.py`, `worker/tests/test_plan.py`, `worker/tests/test_main.py`, `.github/workflows/sync.yml`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `plan.ensure_plan(db, now, bank, topics) -> bool` (True if it created today's set)
  - `plan.refresh_done(db, now) -> int`
  - `__main__.run(db, session, now, env: dict, steps=None) -> dict` with keys `ok: list[str], failed: dict[str,str]`
  - `__main__.main() -> int`

- [ ] **Step 1: Write failing tests**

`worker/tests/test_plan.py`:
```python
from datetime import datetime
from lockin_worker import plan
from lockin_worker.bank import load_bank, load_topics
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB

def _db():
    db = MemoryDB()
    db.insert("settings", [{"daily_lc_count": 6, "lc_started_on": None, "lc_focus_topic": None, "lc_focus_since": None}])
    return db

def test_ensure_plan_creates_set_after_4am():
    db = _db()
    assert plan.ensure_plan(db, datetime(2026, 10, 14, 5, tzinfo=TZ), load_bank(), load_topics())
    [row] = db.select("lc_daily_sets")
    assert row["day"] == "2026-10-14" and len(row["items"]) == 6 and row["focus"] == "Arrays & Hashing"
    s = db.select("settings")[0]
    assert s["lc_started_on"] == "2026-10-14" and s["lc_focus_topic"] == "Arrays & Hashing"

def test_ensure_plan_is_idempotent():
    db = _db()
    now = datetime(2026, 10, 14, 5, tzinfo=TZ)
    plan.ensure_plan(db, now, load_bank(), load_topics())
    assert plan.ensure_plan(db, now, load_bank(), load_topics()) is False
    assert len(db.select("lc_daily_sets")) == 1

def test_before_4am_uses_previous_plan_day():
    db = _db()
    plan.ensure_plan(db, datetime(2026, 10, 15, 2, tzinfo=TZ), load_bank(), load_topics())
    assert db.select("lc_daily_sets")[0]["day"] == "2026-10-14"

def test_refresh_done_marks_solved_items():
    db = _db()
    now = datetime(2026, 10, 14, 5, tzinfo=TZ)
    plan.ensure_plan(db, now, load_bank(), load_topics())
    first = db.select("lc_daily_sets")[0]["items"][0]["slug"]
    db.insert("lc_solves", [{"slug": first, "title": first, "accepted_at": "2026-10-14T15:00:00+00:00"}])
    assert plan.refresh_done(db, datetime(2026, 10, 14, 12, tzinfo=TZ)) == 1
    assert db.select("lc_daily_sets")[0]["items"][0]["done"] is True
```
`worker/tests/test_main.py`:
```python
from datetime import datetime
import pytest
from lockin_worker import __main__ as m
from lockin_worker.clock import TZ
from lockin_worker.db import MemoryDB, DBError

NOW = datetime(2026, 10, 14, 12, tzinfo=TZ)

def test_run_isolates_source_failures():
    db = MemoryDB()
    def boom(*a): raise RuntimeError("google key expired")
    steps = [("sheet", boom), ("leetcode", lambda *a: {"new_solves": 0})]
    out = m.run(db, None, NOW, {}, steps=steps)
    assert out["ok"] == ["leetcode"] and "google key expired" in out["failed"]["sheet"]
    rows = {r["source"]: r for r in db.select("sync_status")}
    assert rows["sheet"]["consecutive_failures"] == 1 and rows["sheet"]["failing_since"]
    assert rows["leetcode"]["consecutive_failures"] == 0 and rows["leetcode"]["last_ok_at"]

def test_recovery_clears_failing_since():
    db = MemoryDB()
    def boom(*a): raise RuntimeError("x")
    m.run(db, None, NOW, {}, steps=[("sheet", boom)])
    m.run(db, None, NOW, {}, steps=[("sheet", lambda *a: {})])
    row = db.select("sync_status")[0]
    assert row["failing_since"] is None and row["consecutive_failures"] == 0

def test_run_fails_when_db_down():
    class DownDB(MemoryDB):
        def select(self, *a, **k): raise DBError("HTTP 503")
    with pytest.raises(DBError):
        m.run(DownDB(), None, NOW, {}, steps=[("leetcode", lambda *a: {})])
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `.venv/bin/pytest tests/test_plan.py tests/test_main.py -v` → FAIL.

- [ ] **Step 3: Implement plan.py**

```python
from __future__ import annotations

from datetime import date, datetime

from . import clock, leetcode, projects
from .daily import DailyInput, build_daily_set


def _settings(db) -> dict:
    rows = db.select("settings")
    return rows[0] if rows else {}


def ensure_plan(db, now: datetime, bank, topics) -> bool:
    pday = clock.plan_day(now)
    if db.select("lc_daily_sets", {"day": pday.isoformat()}):
        return False
    s = _settings(db)
    started = date.fromisoformat(s["lc_started_on"]) if s.get("lc_started_on") else pday
    levels = {r["topic"]: r["level"] for r in db.select("lc_topic_state")}
    states = leetcode.load_states(db)
    solves = db.select("lc_solves")
    attempted = frozenset(x["slug"] for x in solves)
    unaided_mediums = {x["slug"] for x in solves if x["slug"] in bank and bank[x["slug"]].difficulty == "Medium"
                       and x.get("effective_rating") in ("nailed", "struggled")}
    inp = DailyInput(
        today=pday, day_index=(pday - started).days, n=int(s.get("daily_lc_count") or 6),
        focus=s.get("lc_focus_topic"),
        focus_since=date.fromisoformat(s["lc_focus_since"]) if s.get("lc_focus_since") else None,
        levels=levels, states=states, attempted=attempted, lifetime_mediums=len(unaided_mediums))
    p = build_daily_set(inp, bank, topics)
    db.upsert("lc_daily_sets", [{
        "day": pday.isoformat(), "focus": p.focus, "mixed_day": p.mixed_day,
        "items": [{"slug": it.slug, "slot": it.slot, "order": i, "done": False} for i, it in enumerate(p.items)],
    }], on_conflict="day")
    db.update("settings", {}, {"lc_started_on": started.isoformat(), "lc_focus_topic": p.focus,
                               "lc_focus_since": p.focus_since.isoformat()})
    projects.pick_today_idea(db, pday)
    return True


def refresh_done(db, now: datetime) -> int:
    pday = clock.plan_day(now).isoformat()
    sets = db.select("lc_daily_sets", {"day": pday})
    if not sets:
        return 0
    solved_today = {s["slug"] for s in db.select("lc_solves")
                    if clock.plan_day(clock.parse_ts(s["accepted_at"])).isoformat() == pday}
    items = sets[0]["items"]
    changed = 0
    for it in items:
        if not it["done"] and it["slug"] in solved_today:
            it["done"] = True
            changed += 1
    if changed:
        db.update("lc_daily_sets", {"day": pday}, {"items": items})
    return changed
```
`db.update("settings", {}, …)` updates the single settings row. With `RestDB`, an empty `eq` still includes the owner filter. PostgREST rejects an unfiltered PATCH by default, and the owner filter satisfies that.

- [ ] **Step 4: Implement `__main__.py`**

```python
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

from . import clock, jobs, leetcode, nudges, plan, projects, sheet
from .bank import load_bank, load_topics
from .db import RestDB

CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


def _status(db, source: str, now: datetime, err: str | None) -> None:
    prev = (db.select("sync_status", {"source": source}) or [{}])[0]
    if err is None:
        row = {"source": source, "last_ok_at": now.isoformat(), "last_error": None,
               "consecutive_failures": 0, "failing_since": None}
    else:
        row = {"source": source, "last_error": err[:500],
               "consecutive_failures": int(prev.get("consecutive_failures") or 0) + 1,
               "failing_since": prev.get("failing_since") or now.isoformat()}
    db.upsert("sync_status", [row], on_conflict="source")


def default_steps(env: dict):
    settings = {}

    def _settings(db):
        nonlocal settings
        settings = (db.select("settings") or [{}])[0]
        return settings

    def lc(db, session, now):
        return leetcode.sync(db, session, _settings(db).get("lc_username") or "adamkuhn", now)

    def gh(db, session, now):
        return projects.sync(db, session, env.get("LOCKIN_GH_TOKEN") or env.get("GITHUB_TOKEN"), now)

    def sh(db, session, now):
        sid = _settings(db).get("sheet_id") or env.get("SHEET_ID")
        if not sid or not env.get("GOOGLE_SA_JSON"):
            raise RuntimeError("sheet not configured (SHEET_ID / GOOGLE_SA_JSON)")
        return sheet.sync(db, session, sid, json.loads(env["GOOGLE_SA_JSON"]))

    def jb(db, session, now):
        srcs, filters = jobs.load_sources(CONFIG_DIR)
        out = jobs.collect(db, srcs, filters, session, now)
        if out["errors"]:
            # one board failing isn't a "jobs" failure; log it, and fail only if every source failed
            print("job sources failing:", out["errors"])
            if len(out["errors"]) == len(srcs):
                raise RuntimeError("all job sources failed")
        return out

    return [("leetcode", lc), ("github", gh), ("sheet", sh), ("jobs", jb)]


def run(db, session, now: datetime, env: dict, steps=None) -> dict:
    db.select("settings")  # fail fast (and loudly) if Supabase is down
    ok, failed = [], {}
    for name, fn in steps if steps is not None else default_steps(env):
        try:
            print(name, fn(db, session, now))
            _status(db, name, now, None)
            ok.append(name)
        except Exception as exc:
            msg = f"{type(exc).__name__}: {exc}"
            print(f"FAILED {name}: {msg}", file=sys.stderr)
            _status(db, name, now, msg)
            failed[name] = msg
    return {"ok": ok, "failed": failed}


def finish(db, session, now: datetime, env: dict) -> None:
    bank, topics = load_bank(), load_topics()
    today = clock.plan_day(now)
    leetcode.apply_pending(db, bank, today, now)
    leetcode.recompute_levels(db, bank, topics, today)
    plan.ensure_plan(db, now, bank, topics)
    plan.refresh_done(db, now)
    projects.complete_idea_on_commit(db, today, now)
    s = (db.select("settings") or [{}])[0]
    topic = s.get("ntfy_topic") or env.get("NTFY_TOPIC")
    if topic:
        times = s.get("nudge_times") or ["10:00", "18:00", "22:00"]
        print("nudges", nudges.run(db, session, now, topic, s.get("app_url"), times))


def main() -> int:
    env = dict(os.environ)
    db = RestDB(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"], env["LOCKIN_OWNER_ID"])
    session = requests.Session()
    session.headers["User-Agent"] = "lock-in-worker/1.0 (+personal)"
    now = clock.now()
    summary = run(db, session, now, env)
    finish(db, session, now, env)
    print("done", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```
The `nudges.run` signature in Task 9 takes `times` as its last parameter. `finish` passes it, so the two match.

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/pytest -q` → everything passes.

- [ ] **Step 6: Add the cron workflow**

`.github/workflows/sync.yml`:
```yaml
name: sync
on:
  schedule:
    - cron: "7,37 * * * *"   # every 30 min, off the :00/:30 peak
  workflow_dispatch:
concurrency:
  group: sync
  cancel-in-progress: false
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    defaults: { run: { working-directory: worker } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12", cache: pip, cache-dependency-path: worker/pyproject.toml }
      - run: pip install -e .
      - run: python -m lockin_worker
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          LOCKIN_OWNER_ID: ${{ secrets.LOCKIN_OWNER_ID }}
          NTFY_TOPIC: ${{ secrets.NTFY_TOPIC }}
          SHEET_ID: ${{ secrets.SHEET_ID }}
          GOOGLE_SA_JSON: ${{ secrets.GOOGLE_SA_JSON }}
          LOCKIN_GH_TOKEN: ${{ secrets.LOCKIN_GH_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 7: Commit**

```bash
git add worker/lockin_worker/plan.py worker/lockin_worker/__main__.py worker/tests/test_plan.py worker/tests/test_main.py .github/workflows/sync.yml
git commit -m "Add worker orchestrator, daily plan glue and cron workflow"
```

---

### Task 11: Seed script

**Files:**
- Create: `worker/lockin_worker/seed.py`, `worker/tests/test_seed.py`

**Interfaces:**
- Produces: `seed.seed(db, ntfy_topic: str | None, sheet_id: str | None) -> dict` and the CLI `python -m lockin_worker.seed`.

- [ ] **Step 1: Write a failing test**

`worker/tests/test_seed.py`:
```python
from lockin_worker.db import MemoryDB
from lockin_worker.seed import seed

def test_seed_populates_reference_and_defaults():
    db = MemoryDB()
    out = seed(db, "topic-x", "sheet-1")
    assert out == {"problems": 420, "topics": 18, "projects": 2}
    assert db.select("problems", {"slug": "two-sum"})[0]["difficulty"] == "Easy"
    assert sorted(db.select("topics", {"name": "Trees"})[0]["prereqs"]) == ["Binary Search", "Linked List"]
    s = db.select("settings")[0]
    assert s["ntfy_topic"] == "topic-x" and s["sheet_id"] == "sheet-1"
    assert {p["id"] for p in db.select("projects")} == {"27b", "showboat"}

def test_seed_is_rerunnable():
    db = MemoryDB()
    seed(db, "t", "s")
    seed(db, "t", "s")
    assert len(db.select("settings")) == 1 and len(db.select("projects")) == 2
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv/bin/pytest tests/test_seed.py -v` → FAIL.

- [ ] **Step 3: Implement seed.py**

```python
from __future__ import annotations

import os
import sys

from .bank import load_bank, load_topics
from .db import RestDB

PROJECTS = [
    {"id": "27b", "name": "27B", "repo": "adamkuhn1/27b", "local_path": "~/Developer/27b", "active": True},
    {"id": "showboat", "name": "Showboat", "repo": "adamkuhn1/showboat", "local_path": "~/Developer/showboat", "active": True},
]


def seed(db, ntfy_topic: str | None, sheet_id: str | None) -> dict:
    bank, topics = load_bank(), load_topics()
    db.upsert("problems", [{
        "slug": p.slug, "lc_id": p.lc_id, "title": p.title, "difficulty": p.difficulty, "topic": p.topic,
        "lists": list(p.lists), "lc_tags": [], "paid_only": p.paid_only, "ac_rate": p.ac_rate,
        "target_minutes": p.target_minutes, "neetcode_link": p.neetcode_link} for p in bank.values()],
        on_conflict="slug")
    db.upsert("topics", [{"name": t.name, "ord": t.order, "tier": t.tier, "prereqs": list(t.prereqs),
                          "lc_tags": list(t.lc_tags)} for t in topics], on_conflict="name")
    if not db.select("settings"):
        db.insert("settings", [{"ntfy_topic": ntfy_topic, "sheet_id": sheet_id}])
    else:
        db.update("settings", {}, {"ntfy_topic": ntfy_topic, "sheet_id": sheet_id})
    db.upsert("projects", PROJECTS, on_conflict="id")
    return {"problems": len(bank), "topics": len(topics), "projects": len(PROJECTS)}


if __name__ == "__main__":
    env = os.environ
    db = RestDB(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"], env["LOCKIN_OWNER_ID"])
    print(seed(db, env.get("NTFY_TOPIC"), env.get("SHEET_ID")))
    sys.exit(0)
```
Problem `lc_tags` are left empty in the DB copy, because the bank loader doesn't carry them. Plan 2 reads tags from `topics`. If Plan 2 turns out to need per-problem tags, add `lc_tags` to `bank.Problem` then.

- [ ] **Step 4: Run the tests and confirm they pass, then run the full suite**

Run: `.venv/bin/pytest -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add worker/lockin_worker/seed.py worker/tests/test_seed.py
git commit -m "Add seed script for reference data, settings and projects"
```

---

### Task 12: Provision and go live (needs Adam at the keyboard)

These steps involve accounts and secrets, so **stop and hand off to Adam at each one marked 👤**. Never paste keys into chat or commit them. Secrets go straight from Adam's terminal into `gh secret set`.

**Files:**
- Create: `docs/setup.md` (record each step as it's done, with no secret values)

- [ ] **Step 1: 👤 Supabase CLI and login.** `brew install supabase/tap/supabase`, then Adam runs `supabase login` himself (it opens the browser). Check the free-tier slot with `supabase projects list`. If two free projects are already active, stop and ask Adam which way to go. Don't touch Promotr's project.
- [ ] **Step 2: Create the project.** `supabase projects create lock-in --org-id <from supabase orgs list> --region us-east-1 --db-password "$(openssl rand -base64 24)"`. Run `supabase link --project-ref <ref>` from the repo root (Adam enters the DB password from the prompt if asked). Then `supabase db push` applies `0001_init.sql`.
- [ ] **Step 3: Create Adam's auth user and turn off sign-ups.** In the dashboard (Authentication → Users → Add user → his email, auto-confirm), copy the user's UUID. Then Authentication → Sign In / Providers → turn off "Allow new users to sign up". Record that this was done in `docs/setup.md`.
- [ ] **Step 4: 👤 Google service account.** Walk Adam through it step by step:
  - Go to console.cloud.google.com, create a project called "lock-in", and enable the Google Sheets API.
  - Go to IAM → Service Accounts → Create, then Keys → Add key → JSON. Save the key to `~/Downloads`.
  - Share the Sheet with the service account's `client_email` as **Viewer**.
- [ ] **Step 5: 👤 Create the GitHub repo and set secrets.** Run `gh repo create adamkuhn1/lock-in --private --source . --push`. Then Adam runs each of these himself, pasting values at the prompts rather than as arguments:
  ```bash
  gh secret set SUPABASE_URL          # https://<ref>.supabase.co
  gh secret set SUPABASE_SERVICE_KEY  # Settings → API → service_role
  gh secret set LOCKIN_OWNER_ID       # UUID from Step 3
  gh secret set NTFY_TOPIC            # same topic job-radar uses
  gh secret set SHEET_ID --body 1Iq2PHFtzhwDokzWjlRndeAw1RSsEZpgKEoLGGE2iaDI
  gh secret set GOOGLE_SA_JSON < ~/Downloads/<key>.json && rm ~/Downloads/<key>.json
  gh secret set LOCKIN_GH_TOKEN       # fine-grained PAT, read-only Contents on 27b + showboat (only needed if either repo is private)
  ```
- [ ] **Step 6: Seed.** Locally, with the same values exported in Adam's shell (he runs `read -s` for the service key): `cd worker && .venv/bin/python -m lockin_worker.seed` → expect `{'problems': 420, 'topics': 18, 'projects': 2}`.
- [ ] **Step 7: First run.** `gh workflow run sync && gh run watch`. Expected: a green run. The logs should show `leetcode {'new_solves': ≤20}`, `github {...}`, `sheet {'rows': ~80}`, and `jobs {'new': 0, 'seeded': N}`. Check in the Supabase table editor that `lc_daily_sets` has today's row with 6 items in `Arrays & Hashing`, `applications` has about 80 rows, and `sync_status` has 4 rows with `consecutive_failures = 0`.
- [ ] **Step 8: Check the nudge.** If the run is after 10:00 ET, Adam's phone gets "Today's plan" right away. Otherwise trigger a test with `gh workflow run sync` after 10:00. Confirm a second run doesn't re-send it.
- [ ] **Step 9: Write `docs/setup.md` and commit**

```bash
git add docs/setup.md
git commit -m "Document Lock In provisioning steps"
git push
```

---

## Self-Review Notes

- **Spec coverage:**
  - §3 architecture → Tasks 1, 10, 12
  - §4 data model → Task 2. `outreach`, `contacts` and `launch_requests` are created now but used in Plan 3.
  - §6 LeetCode → Tasks 3–6, 10. Sync-on-open is in Plan 2.
  - §7 projects → Task 7b. The Suggest button is in Plan 3.
  - §9 jobs → Task 8. The cutover is in Plan 3.
  - §10 sheet → Task 7
  - §11 nudges → Task 9
  - §12 errors → Tasks 9 and 10
  - §13 tests → every task; CI in Task 1
  - §14 setup → Task 12
  - §2's "screens", outreach and launcher → Plans 2 and 3.
- **Spec clarifications made in this plan:**
  - an `available` level was added
  - the struggled interval grows by at least 1 day
  - focus rotates to another eligible topic after 10 days
  - after an outage, only the latest due nudge is sent
  - bootstrap needs no special code: the existing last-20 solves go through the normal unrated→struggled path the next day, so they enter review, and their attempts seed topic levels
  - tag counts are stored for display and don't directly set levels
