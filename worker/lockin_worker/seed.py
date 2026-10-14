from __future__ import annotations

import os

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
    given = {k: v for k, v in {"ntfy_topic": ntfy_topic, "sheet_id": sheet_id}.items() if v is not None}
    if not db.select("settings"):
        db.insert("settings", [given])
    elif given:
        db.update("settings", {}, given)
    db.upsert("projects", PROJECTS, on_conflict="id")
    return {"problems": len(bank), "topics": len(topics), "projects": len(PROJECTS)}


if __name__ == "__main__":
    env = os.environ
    db = RestDB(env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"], env["LOCKIN_OWNER_ID"])
    print(seed(db, env.get("NTFY_TOPIC"), env.get("SHEET_ID")))
