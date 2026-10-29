"""Learning tracks (Grind → CS, Math, Founder): the content in shared/learning.json and Claude's write-backs.

The worker upserts the content into learn_modules / learn_items whenever the file changes, so editing the JSON
and pushing is all it takes. Progress lives in learn_progress, learn_module_state and learn_checks (migration 0012).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[2] / "shared" / "learning.json"
STATE_KEY = "learn_content"
TRACKS = ("cs", "math", "founder")
TYPES = ("watch", "do", "build", "check")
CHECK_KINDS = ("quiz", "explain", "honor")
RATINGS = ("nailed", "struggled", "help")
STATUSES = ("not_started", "in_progress", "done")


class ContentError(Exception):
    pass


def load(path: Path = CONTENT) -> tuple[list[dict], list[dict]]:
    """(modules, items) rows for the database, after checking the file's shape."""
    data = json.loads(path.read_text(encoding="utf-8"))
    modules, items, ids = [], [], set()
    for track in data.get("tracks") or []:
        if track.get("id") not in TRACKS:
            raise ContentError(f"unknown track {track.get('id')!r}")
        for m in track.get("modules") or []:
            mid = m.get("id")
            if not mid or mid in ids:
                raise ContentError(f"module id missing or repeated: {mid!r}")
            ids.add(mid)
            modules.append({"id": mid, "track": track["id"], "ord": int(m["ord"]), "title": m["title"],
                            "summary": m.get("summary") or ""})
            kinds = set()
            for i, it in enumerate(m.get("items") or []):
                iid, typ = it.get("id"), it.get("type")
                if not iid or iid in ids:
                    raise ContentError(f"{mid}: item id missing or repeated: {iid!r}")
                if typ not in TYPES:
                    raise ContentError(f"{iid}: type must be one of {TYPES}")
                check = it.get("check")
                if (typ == "check") != (check is not None) or (check is not None and check not in CHECK_KINDS):
                    raise ContentError(f"{iid}: check items need check: quiz | explain | honor (and only check items)")
                url = it.get("url")
                if url is not None and not str(url).startswith("https://"):
                    raise ContentError(f"{iid}: url must be https:// or null")
                ids.add(iid)
                kinds.add(typ)
                items.append({"id": iid, "module_id": mid, "ord": i + 1, "type": typ, "title": it["title"], "url": url,
                              "hours": float(it.get("hours") or 0), "project": it.get("project") if typ == "build" else None,
                              "check_kind": check, "details": details(it)})
            missing = set(TYPES) - kinds
            if missing:
                raise ContentError(f"{mid}: needs at least one item of each type; missing {sorted(missing)}")
    return modules, items


def details(it: dict) -> str:
    """What to do, then (for watch and do items) why it's the pick: "Why this: ..." shows under the item in the app."""
    text, why = (it.get("details") or "").strip(), (it.get("why") or "").strip()
    return f"{text} Why this: {why}".strip() if why else text


def sync_content(db, path: Path = CONTENT) -> dict:
    """Upsert the tracks when shared/learning.json changed since the last sync; drop items and modules it removed."""
    if not path.exists():
        return {"skipped": "no content file"}
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    st = db.select("worker_state", {"key": STATE_KEY})
    if st and (st[0].get("value") or {}).get("sha") == digest:
        return {"unchanged": 1}
    modules, items = load(path)
    db.upsert("learn_modules", modules, on_conflict="id")
    db.upsert("learn_items", items, on_conflict="id")
    keep_items, keep_modules = {i["id"] for i in items}, {m["id"] for m in modules}
    gone = 0
    for r in db.select("learn_items"):
        if r["id"] not in keep_items:
            db.delete("learn_items", {"id": r["id"]})
            gone += 1
    for r in db.select("learn_modules"):
        if r["id"] not in keep_modules:
            db.delete("learn_modules", {"id": r["id"]})
            gone += 1
    db.upsert("worker_state", [{"key": STATE_KEY, "value": {"sha": digest}}], on_conflict="key")
    return {"modules": len(modules), "items": len(items), "removed": gone}


def rating_for(score: int, total: int) -> str:
    """Quiz score → the LeetCode scale: 80%+ nailed, 50%+ struggled, else needed help."""
    pct = score / total
    return "nailed" if pct >= 0.8 else "struggled" if pct >= 0.5 else "help"
