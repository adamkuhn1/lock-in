from __future__ import annotations

import copy
from typing import Protocol

import requests

GLOBAL_TABLES = {"problems", "topics", "prep_items"}
TIMEOUT = 30
PAGE = 1000
# Stable sort key per table so Range-based pagination never skips or repeats rows (owner is already filtered).
ORDER = {
    "lc_solves": "id", "applications": "id", "problems": "slug", "topics": "name",
    "lc_problem_state": "slug", "lc_topic_state": "topic", "lc_daily_sets": "day", "lc_tag_counts": "tag",
    "projects": "id", "commits": "sha", "ideas": "id", "postings": "id", "outreach": "id", "contacts": "id",
    "launch_requests": "id", "sync_status": "source", "worker_state": "key", "settings": "owner",
    "stories": "id", "prep_sessions": "id", "prep_items": "id", "prep_progress": "item_id",
    "company_prep": "id", "events": "id",
}


class DBError(Exception):
    pass


class DB(Protocol):
    def select(self, table: str, eq: dict | None = None) -> list[dict]: ...
    def upsert(self, table: str, rows: list[dict], on_conflict: str, *, ignore_duplicates: bool = False) -> None: ...
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

    def upsert(self, table, rows, on_conflict, *, ignore_duplicates=False):
        keys = [k.strip() for k in on_conflict.split(",")]
        t = self._t(table)
        for row in rows:
            hit = next((r for r in t if all(r.get(k) == row.get(k) for k in keys)), None)
            if hit is None:
                t.append(copy.deepcopy(row))
            elif not ignore_duplicates:
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
            text = str(v).lower() if isinstance(v, bool) else v
            params[k] = f"eq.{text}"
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
        if table in ORDER:
            params["order"] = ORDER[table]
        out: list[dict] = []
        while True:  # PostgREST caps a response at 1000 rows; never truncate silently
            headers = {**self._headers(), "Range-Unit": "items", "Range": f"{len(out)}-{len(out) + PAGE - 1}"}
            page = self._call("GET", table, params=params, headers=headers).json()
            out.extend(page)
            if len(page) < PAGE:
                return out

    def insert(self, table, rows):
        if rows:
            self._call("POST", table, json=self._owned(table, rows), headers=self._headers("return=minimal"))

    def upsert(self, table, rows, on_conflict, *, ignore_duplicates=False):
        if not rows:
            return
        cols = on_conflict if table in GLOBAL_TABLES else f"owner,{on_conflict}"
        self._call("POST", table, json=self._owned(table, rows), params={"on_conflict": cols},
                   headers=self._headers(f"resolution={'ignore' if ignore_duplicates else 'merge'}-duplicates,return=minimal"))

    def update(self, table, eq, values):
        self._call("PATCH", table, json=values, params=self._filters(table, eq),
                   headers=self._headers("return=minimal"))

    def delete(self, table, eq=None):
        self._call("DELETE", table, params=self._filters(table, eq), headers=self._headers("return=minimal"))
