from datetime import date
from lockin_worker.agenda import agenda
from lockin_worker.db import MemoryDB

D = date(2026, 10, 14)


def test_agenda_lists_today_then_tomorrow_from_three_sources_capped():
    db = MemoryDB()
    db.insert("events", [
        {"title": "Stripe OA", "kind": "oa", "on_date": "2026-10-14", "at_time": "15:00"},
        {"title": "Ramp deadline", "kind": "deadline", "on_date": "2026-10-16", "at_time": None},
        {"title": "Career fair", "kind": "other", "on_date": "2026-10-14", "at_time": "09:00"},
    ])
    db.insert("company_prep", [{"company": "Figma", "interview_on": "2026-10-15"}])
    db.insert("outreach", [{"company": "Ramp", "status": "sent", "follow_up_on": "2026-10-15"},
                           {"company": "Old", "status": "drafted", "follow_up_on": "2026-10-14"}])
    assert agenda(db, D) == ["Career fair today", "Stripe OA today", "Figma interview tomorrow"]
    assert agenda(db, D, limit=10)[-1] == "Follow up: Ramp tomorrow"


def test_agenda_empty():
    assert agenda(MemoryDB(), D) == []
