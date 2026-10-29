from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from typing import Any

import requests

from . import clock, creds, picks
from .db import DBError

CONFIDENCE = ("verified", "pattern", "guess")
SIZES = ("S", "M")
MAX_CONTACTS = 5
MAX_IDEAS = 10
WORD_TARGET = 110
EMAIL = re.compile(r"^[^\s@,;?&#<>\"']+@[^\s@,;?&#<>\"']+\.[A-Za-z]{2,}$")
RESUME_PATH_MAX = 500
HEREDOC_HINT = "Pipe the JSON in with a quoted heredoc, e.g.  lockin save-ideas --project 27b <<'JSON' ... JSON"


class InputError(Exception):
    pass


def parse_json(text: str) -> Any:
    if not text.strip():
        raise InputError(f"no JSON on stdin. {HEREDOC_HINT}")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise InputError(f"invalid JSON: {e.msg} at line {e.lineno} column {e.colno}") from None


def _str(obj: dict, key: str, path: str, errors: list[str], required=False, max_len: int | None = None) -> str | None:
    v = obj.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            errors.append(f"{path}.{key}: required")
        return None
    if not isinstance(v, str):
        errors.append(f"{path}.{key}: must be a string")
        return None
    v = v.strip()
    if max_len is not None and len(v) > max_len:
        errors.append(f"{path}.{key}: longer than {max_len} characters")
    return v


def validate_outreach(data: Any) -> tuple[dict, list[str]]:
    if not isinstance(data, dict):
        raise InputError("expected a JSON object with company, role and contacts")
    errors: list[str] = []
    warnings: list[str] = []
    company = _str(data, "company", "$", errors, max_len=200)
    role = _str(data, "role", "$", errors, max_len=200)
    resume_path = _str(data, "resume_path", "$", errors, max_len=RESUME_PATH_MAX)
    if resume_path and not resume_path.startswith("/"):
        errors.append("$.resume_path: must be an absolute path")
    contacts = data.get("contacts")
    if not isinstance(contacts, list) or (not contacts and not resume_path):
        # An empty list is fine only when this save records a tailored resume (no recruiter found).
        errors.append("$.contacts: must be a non-empty list")
        contacts = []
    elif len(contacts) > MAX_CONTACTS:
        errors.append(f"$.contacts: at most {MAX_CONTACTS} contacts")
    clean = []
    for i, c in enumerate(contacts[:MAX_CONTACTS]):
        p = f"$.contacts[{i}]"
        if not isinstance(c, dict):
            errors.append(f"{p}: must be an object")
            continue
        row = {
            "name": _str(c, "name", p, errors, required=True, max_len=200),
            "title": _str(c, "title", p, errors, max_len=200),
            "linkedin_url": _str(c, "linkedin_url", p, errors, max_len=500),
            "email_guess": _str(c, "email_guess", p, errors, max_len=200),
            "email_confidence": _str(c, "email_confidence", p, errors),
            "why": _str(c, "why", p, errors, max_len=500),
            "draft_subject": _str(c, "draft_subject", p, errors, required=True, max_len=150),
            "draft_body": _str(c, "draft_body", p, errors, required=True, max_len=3000),
        }
        if row["linkedin_url"] and not row["linkedin_url"].startswith(("https://", "http://")):
            errors.append(f"{p}.linkedin_url: must start with https://")
        if row["email_guess"] and not EMAIL.match(row["email_guess"]):
            errors.append(f"{p}.email_guess: not an email address")
        if row["email_confidence"] is None and row["email_guess"]:
            errors.append(f"{p}.email_confidence: required when email_guess is set (verified, pattern or guess)")
        elif row["email_confidence"] is not None and row["email_confidence"] not in CONFIDENCE:
            errors.append(f"{p}.email_confidence: must be one of verified, pattern, guess")
        if row["draft_body"]:
            words = len(row["draft_body"].split())
            if words > WORD_TARGET:
                warnings.append(f"{p}.draft_body: {words} words (aim for under {WORD_TARGET})")
        clean.append(row)
    if errors:
        raise InputError("\n".join(errors))
    out = {"company": company, "role": role, "contacts": clean}
    if resume_path:
        out["resume_path"] = resume_path
    return out, warnings


def validate_ideas(data: Any) -> list[dict]:
    if not isinstance(data, list) or not data:
        raise InputError('expected a non-empty JSON list like [{"text": "...", "size": "S"}]')
    errors: list[str] = []
    if len(data) > MAX_IDEAS:
        errors.append(f"$: at most {MAX_IDEAS} ideas")
    out = []
    for i, idea in enumerate(data[:MAX_IDEAS]):
        p = f"$[{i}]"
        if not isinstance(idea, dict):
            errors.append(f"{p}: must be an object")
            continue
        text = _str(idea, "text", p, errors, required=True, max_len=200)
        details = _str(idea, "details", p, errors, max_len=1000)
        size = idea.get("size", "S")
        if size not in SIZES:
            errors.append(f"{p}.size: must be S or M")
        out.append({"text": text, "size": size, **({"details": details} if details else {})})
    if errors:
        raise InputError("\n".join(errors))
    return out


def save_outreach(db, outreach_id: str, data: dict) -> int:
    rows = db.select("outreach", {"id": outreach_id})
    if not rows:
        raise InputError(f"no outreach request with id {outreach_id}")
    o = rows[0]
    if data["contacts"]:  # a resume-only save leaves earlier drafts alone
        old_ids = [r["id"] for r in db.select("contacts", {"outreach_id": outreach_id}) if r.get("id")]
        db.insert("contacts", [{**c, "outreach_id": outreach_id} for c in data["contacts"]])
        for old_id in old_ids:
            db.delete("contacts", {"id": old_id})
    patch: dict = {}
    if o.get("status") == "queued" and data["contacts"]:
        patch["status"] = "drafted"
    if not o.get("company") and data["company"]:
        patch["company"] = data["company"]
    if not o.get("role") and data["role"]:
        patch["role"] = data["role"]
    if data.get("resume_path"):
        patch["resume_path"] = data["resume_path"]
    if patch:
        db.update("outreach", {"id": outreach_id}, patch)
    return len(data["contacts"])


def save_ideas(db, project_id: str, ideas: list[dict]) -> tuple[int, int]:
    if not db.select("projects", {"id": project_id}):
        raise InputError(f"no project with id {project_id!r}")
    existing = db.select("ideas", {"project_id": project_id})
    seen = {str(i["text"]).strip().lower() for i in existing if i.get("status") in ("todo", "today")}
    pos = max((int(i.get("position") or 0) for i in existing), default=-1) + 1
    new = []
    for idea in ideas:
        key = idea["text"].lower()
        if key in seen:
            continue
        seen.add(key)
        row = {"project_id": project_id, "text": idea["text"], "size": idea["size"],
               "status": "todo", "source": "claude", "position": pos}
        if idea.get("details"):
            row["details"] = idea["details"]  # needs migration 0007
        new.append(row)
        pos += 1
    db.insert("ideas", new)
    return len(new), len(ideas) - len(new)


PICKS = ("ex_apple", "cmu", "team", "other")
MAX_ENGINEERS = 2
NOTE_MAX = 280  # LinkedIn connection notes are short; the database enforces it too (migration 0011)
LINKEDIN_PROFILE = re.compile(r"^https://([a-z]{2,3}\.)?(www\.)?linkedin\.com/in/[^\s/?#]+/?$", re.I)
_ROLE_NOISE = {"engineer", "software", "new", "grad", "graduate", "intern", "2027", "role", "the", "and", "university"}


def validate_engineers(data: Any) -> tuple[dict, list[str]]:
    if not isinstance(data, dict):
        raise InputError("expected a JSON object with company, role and engineers")
    errors: list[str] = []
    warnings: list[str] = []
    company = _str(data, "company", "$", errors, max_len=200)
    role = _str(data, "role", "$", errors, max_len=200)
    people = data.get("engineers")
    if not isinstance(people, list) or not people:
        errors.append("$.engineers: must be a non-empty list")
        people = []
    elif len(people) > MAX_ENGINEERS:
        errors.append(f"$.engineers: at most {MAX_ENGINEERS} engineers")
    clean = []
    for i, e in enumerate(people[:MAX_ENGINEERS]):
        p = f"$.engineers[{i}]"
        if not isinstance(e, dict):
            errors.append(f"{p}: must be an object")
            continue
        row = {
            "name": _str(e, "name", p, errors, required=True, max_len=200),
            "title": _str(e, "title", p, errors, max_len=200),
            "profile_url": _str(e, "profile_url", p, errors, required=True, max_len=500),
            "pick": _str(e, "pick", p, errors) or "other",
            "why": _str(e, "why", p, errors, max_len=500),
            "note": _str(e, "note", p, errors, required=True),
        }
        if row["profile_url"] and not LINKEDIN_PROFILE.match(row["profile_url"]):
            errors.append(f"{p}.profile_url: must be a https://www.linkedin.com/in/... profile link")
        if row["pick"] not in PICKS:
            errors.append(f"{p}.pick: must be one of {', '.join(PICKS)}")
        note = row["note"] or ""
        if len(note) > NOTE_MAX:
            errors.append(f"{p}.note: {len(note)} characters; LinkedIn notes must be under {NOTE_MAX}")
        if note and "apple" not in note.lower():
            warnings.append(f"{p}.note: doesn't mention the Apple internship")
        words = {w for w in re.findall(r"[a-z0-9]+", (role or "").lower()) if len(w) > 2} - _ROLE_NOISE
        if note and words and not any(w in note.lower() for w in words):
            warnings.append(f"{p}.note: doesn't name the role ({role})")
        clean.append(row)
    if errors:
        raise InputError("\n".join(errors))
    return {"company": company, "role": role, "engineers": clean}, warnings


def _profile_key(url: str | None) -> str:
    return re.sub(r"^https?://([a-z]{2,3}\.)?(www\.)?", "", (url or "").strip().lower()).rstrip("/")


def save_engineers(db, request_id: str, data: dict) -> tuple[int, list[str]]:
    """Save Claude's picks against their Find engineers request. Returns (saved, skipped names).

    Saving again replaces this request's unsent drafts. Anyone already in Lock In for the company (an earlier run,
    or a note already sent) is skipped, so nobody gets asked twice."""
    from job_radar.tiers import company_key

    reqs = db.select("launch_requests", {"id": request_id})
    if not reqs or reqs[0].get("kind") != "find_engineers":
        raise InputError(f"no Find engineers request with id {request_id}")
    p = reqs[0].get("payload") or {}
    company = (p.get("company") or data["company"] or "").strip()
    if not company:
        raise InputError("$.company: required (the request has no company)")
    existing = db.select("referrals")
    old = [r for r in existing if r.get("request_id") == request_id and r.get("status") == "drafted"]
    taken = {_profile_key(r.get("profile_url")) for r in existing
             if r not in old and company_key(r.get("company")) == company_key(company)}
    rows, skipped = [], []
    for e in data["engineers"]:
        if _profile_key(e["profile_url"]) in taken:
            skipped.append(e["name"])
            continue
        taken.add(_profile_key(e["profile_url"]))
        rows.append({**e, "id": str(uuid.uuid4()), "request_id": request_id, "posting_id": p.get("posting_id"), "job_url": p.get("job_url"),
                     "company": company, "role": p.get("role") or data["role"], "tier": p.get("tier"), "status": "drafted"})
    if rows:
        db.insert("referrals", rows)
        for r in old:
            db.delete("referrals", {"id": r["id"]})
    return len(rows), skipped


SKIP_REASON_MAX = 300


def skip_job(db, outreach_id: str, reason: str) -> int:
    """Claude's fit check said no: close the outreach card, dismiss the posting, keep the reason for the app.

    Returns how many postings were dismissed. A card already emailed is left alone."""
    reason = " ".join(reason.split())[:SKIP_REASON_MAX]
    if not reason:
        raise InputError("--reason is required: one line on why the role doesn't fit")
    rows = db.select("outreach", {"id": outreach_id})
    if not rows:
        raise InputError(f"no outreach request with id {outreach_id}")
    o = rows[0]
    if o.get("status") in ("sent", "replied"):
        raise InputError("this card was already emailed; close it in the app instead")
    db.update("outreach", {"id": outreach_id}, {"status": "closed"})
    reqs = [r for r in db.select("launch_requests") if (r.get("payload") or {}).get("outreach_id") == outreach_id]
    if reqs:
        last = max(reqs, key=lambda r: str(r.get("created_at") or ""))
        db.update("launch_requests", {"id": last["id"]}, {"payload": {**(last.get("payload") or {}), "skipped": reason}})
    posts = [p for p in db.select("postings", {"url": o["job_url"]}) if p.get("status") != "applied"] if o.get("job_url") else []
    for p in posts:
        db.update("postings", {"id": p["id"]}, {"status": "dismissed"})
    return len(posts)


def skip_request(db, request_id: str, reason: str) -> int:
    """The fit check in Find engineers said no: dismiss the posting and keep the reason on the request for the app."""
    reason = " ".join(reason.split())[:SKIP_REASON_MAX]
    if not reason:
        raise InputError("--reason is required: one line on why the role doesn't fit")
    reqs = db.select("launch_requests", {"id": request_id})
    if not reqs:
        raise InputError(f"no launch request with id {request_id}")
    p = reqs[0].get("payload") or {}
    db.update("launch_requests", {"id": request_id}, {"payload": {**p, "skipped": reason}})
    posts = db.select("postings", {"id": p["posting_id"]}) if p.get("posting_id") else []
    if not posts and p.get("job_url"):
        posts = db.select("postings", {"url": p["job_url"]})
    posts = [x for x in posts if x.get("status") != "applied"]
    for x in posts:
        db.update("postings", {"id": x["id"]}, {"status": "dismissed"})
    return len(posts)


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def main(argv=None, stdin=None, stdout=None, stderr=None, db_factory=creds.make_db, link_check=None) -> int:
    stdin, stdout, stderr = stdin or sys.stdin, stdout or sys.stdout, stderr or sys.stderr
    ap = argparse.ArgumentParser(prog="lockin", description="Save Claude Code results into Lock In.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    so = sub.add_parser("save-outreach", help="read contacts JSON on stdin")
    so.add_argument("--id", required=True, help="outreach id from the prompt")
    si = sub.add_parser("save-ideas", help="read ideas JSON list on stdin")
    si.add_argument("--project", required=True, help="project id, e.g. 27b")
    sk = sub.add_parser("skip-job", help="the role doesn't fit: close the outreach card and dismiss the posting")
    who = sk.add_mutually_exclusive_group(required=True)
    who.add_argument("--id", help="outreach id from the prompt")
    who.add_argument("--request", help="Find engineers request id from the prompt")
    se = sub.add_parser("save-engineers", help="read the Find engineers JSON on stdin")
    se.add_argument("--request", required=True, help="request id from the prompt")
    sk.add_argument("--reason", required=True, help="one line, e.g. 'PhD required'")
    sub.add_parser("save-picks", help="read the Best fit shortlist (JSON list, best first) on stdin")
    sub.add_parser("doctor", help="check Keychain credentials and the database connection")
    lp = sub.add_parser("log-prep", help="log a prep session (used by Mock with Claude)")
    lp.add_argument("--kind", required=True, choices=["oa", "mock", "study", "story"])
    lp.add_argument("--minutes", type=int)
    lp.add_argument("--note", default="")
    lp.add_argument("--company")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "doctor":
            db = db_factory()
            db.select("settings")
            queued = len(db.select("launch_requests", {"status": "queued"}))
            print(f"OK: connected to Supabase, {_plural(queued, 'queued launch request')}", file=stdout)
            return 0
        if args.cmd == "skip-job":
            if args.request:
                n = skip_request(db_factory(), args.request, args.reason)
                print(f"Skipped: {_plural(n, 'posting')} dismissed", file=stdout)
                return 0
            n = skip_job(db_factory(), args.id, args.reason)
            print(f"Skipped: card moved to Done, {_plural(n, 'posting')} dismissed", file=stdout)
            return 0
        if args.cmd == "log-prep":
            if args.minutes is not None and not 1 <= args.minutes <= 600:
                raise InputError("--minutes must be between 1 and 600")
            row = {"kind": args.kind, "minutes": args.minutes, "note": args.note.strip()[:500] or None,
                   "company": (args.company or "").strip() or None,
                   "happened_on": clock.plan_day(clock.now()).isoformat()}
            db_factory().insert("prep_sessions", [row])
            print(f"Logged {args.kind} session", file=stdout)
            return 0
        payload = parse_json(stdin.read())
        if args.cmd == "save-picks":
            r = picks.save(db_factory(), picks.validate(payload), now=clock.now(), check=link_check or picks.check_link)
            for note in r["unverified"]:
                print(f"warning: couldn't check {note}; saved because you opened it yourself", file=stderr)
            for note in r["skipped"]:
                print(f"skipped {note}", file=stderr)
            print(f"Saved {_plural(r['inbox'] + r['new'], 'best fit')} ({r['inbox']} from the inbox, {r['new']} new)", file=stdout)
            return 0
        if args.cmd == "save-engineers":
            data, warnings = validate_engineers(payload)
            for w in warnings:
                print(f"warning: {w}", file=stderr)
            n, skipped = save_engineers(db_factory(), args.request, data)
            for name in skipped:
                print(f"skipped {name}: already in Lock In for this company", file=stderr)
            print(f"Saved {_plural(n, 'engineer')}", file=stdout)
            return 0
        if args.cmd == "save-outreach":
            data, warnings = validate_outreach(payload)
            for w in warnings:
                print(f"warning: {w}", file=stderr)
            n = save_outreach(db_factory(), args.id, data)
            resume_note = "resume, " if data.get("resume_path") else ""
            print(f"Saved {resume_note}{_plural(n, 'contact')}", file=stdout)
        else:
            saved, skipped = save_ideas(db_factory(), args.project, validate_ideas(payload))
            tail = f" ({_plural(skipped, 'duplicate')} skipped)" if skipped else ""
            print(f"Saved {_plural(saved, 'idea')}{tail}", file=stdout)
        return 0
    except (InputError, picks.PickError) as e:
        print(f"error: {e}", file=stderr)
        return 2
    except (creds.CredsError, DBError) as e:
        print(f"error: {e}", file=stderr)
        return 1
    except (requests.RequestException, OSError) as e:
        print(f"error: {type(e).__name__}: {str(e)[:200]}", file=stderr)
        return 1


def main_entry() -> None:
    sys.exit(main())
