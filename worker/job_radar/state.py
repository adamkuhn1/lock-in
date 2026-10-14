"""Persistent state in data/seen.json.

{
  "version": 1,
  "sources": {"greenhouse:stripe": {"seen": {"<job id>": "2026-10-06"}, "sha": "..."}},
  "alerted": {"<company|title|location fingerprint>": "2026-10-06"},
  "failing": {"lever:foo": {"since": "...", "error": "HTTP 404 ..."}},
  "daily": {"last_ping_date": "2026-10-06", "count": 3}
}
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

VERSION = 1
SEEN_RETENTION_DAYS = 60  # forget closed postings after this long
ALERTED_RETENTION_DAYS = 30


def empty() -> dict:
    return {"version": VERSION, "sources": {}, "alerted": {}, "failing": {}, "daily": {}}


def load(path: Path) -> dict:
    if not path.exists():
        return empty()
    data = json.loads(path.read_text())
    base = empty()
    base.update(data)
    return base


def save(state: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # indent + sorted keys keep git diffs small and line-based
    path.write_text(json.dumps(state, indent=1, sort_keys=True, ensure_ascii=False) + "\n")


def prune(state: dict, current_ids: dict[str, set[str]], today: date) -> None:
    """Drop seen ids that are no longer listed and are older than retention.

    Only sources fetched successfully this run (keys of current_ids) are pruned."""
    cutoff = (today - timedelta(days=SEEN_RETENTION_DAYS)).isoformat()
    for key, ids in current_ids.items():
        seen = state["sources"].get(key, {}).get("seen", {})
        for job_id in [j for j, d in seen.items() if j not in ids and d < cutoff]:
            del seen[job_id]
    alerted_cutoff = (today - timedelta(days=ALERTED_RETENTION_DAYS)).isoformat()
    state["alerted"] = {k: d for k, d in state["alerted"].items() if d >= alerted_cutoff}
