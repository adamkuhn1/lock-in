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
    (r"not applied|to apply|planned|draft|wishlist", "other"),
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
    for i, row in enumerate(values[header_i + 1:], start=header_i + 2):
        get = lambda k: (row[cols[k]].strip() or None) if k in cols and cols[k] < len(row) else None
        company = get("company")
        if not company:
            continue
        rec = {k: get(k) for k in ("company", "role", "track", "term", "location", "status", "priority")}
        rec["applied_on"] = _date(get("applied_on"))
        rec["stage"] = status_stage(rec["status"])
        rec["row_hash"] = hashlib.sha1("\x1f".join(str(c) for c in row).encode()).hexdigest()
        # 1-based Sheet row (RANGE starts at A1); not part of row_hash, so a moved row keeps its hash.
        rec["sheet_row"] = i
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


def sync(db, session, sheet_id: str, sa_info: dict, index=None) -> dict:
    rows = map_rows(fetch_values(session, sheet_id, sa_info))
    if index is not None:  # reach / volume / midwest, from the company and the Sheet's Location column (migration 0011)
        for r in rows:
            r["tier"] = index.tier(r["company"], (r.get("location") or "",))
    db.delete("applications")
    db.insert("applications", rows)
    return {"rows": len(rows)}
