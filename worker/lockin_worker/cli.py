from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

import requests

from . import clock, creds
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


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def main(argv=None, stdin=None, stdout=None, stderr=None, db_factory=creds.make_db) -> int:
    stdin, stdout, stderr = stdin or sys.stdin, stdout or sys.stdout, stderr or sys.stderr
    ap = argparse.ArgumentParser(prog="lockin", description="Save Claude Code results into Lock In.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    so = sub.add_parser("save-outreach", help="read contacts JSON on stdin")
    so.add_argument("--id", required=True, help="outreach id from the prompt")
    si = sub.add_parser("save-ideas", help="read ideas JSON list on stdin")
    si.add_argument("--project", required=True, help="project id, e.g. 27b")
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
    except InputError as e:
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
