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

def test_status_stage_not_yet_applied_is_other():
    for s in ("Not applied yet", "To apply", "Planned", "Draft", "Wishlist", "Planned - apply by Fri"):
        assert sheet.status_stage(s) == "other", s

def test_status_stage_offer_outcomes_count_as_offer():
    # ruling: an offer was received, so the funnel counts it even if later declined or rescinded
    assert sheet.status_stage("Offer declined") == "offer"
    assert sheet.status_stage("Offer rescinded") == "offer"

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
