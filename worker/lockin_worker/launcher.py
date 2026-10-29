from __future__ import annotations

import errno
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from job_radar import tiers

from . import creds, profile, prompts, resume, terminal

POLL_SECONDS = 10
DEFAULT_ROOT = "~/Desktop/Adam_Kuhn_Resumes"
ERROR_MAX = 500
DEFAULT_OUTREACH_DIR = Path.home() / ".lockin" / "outreach"
OUTREACH_DIR = DEFAULT_OUTREACH_DIR  # Claude runs here, not in $HOME
MOCK_DIR = Path.home() / ".lockin" / "mock"  # mock interviews run here, not in $HOME
DEFAULT_TAILOR_DIR = Path.home() / ".lockin" / "tailor"
TAILOR_DIR = DEFAULT_TAILOR_DIR  # one work dir per tailored resume, never inside the resume folders
BEST_FIT_DIR = Path.home() / ".lockin" / "best_fit"  # Find best fits runs here, with the JSON it reads
REPORT_DIR = Path.home() / ".lockin" / "report"  # Make PDF report runs here, one dated folder per report
PASSED_MAX = 150  # most recent dismissed postings shown to Claude as "not interested"
BASE_RESUME = "Base_Resume"
RESUME_STEM = "Adam_Kuhn_Resume"
FOLDER_HINT_MAX = 80
JOB_URL_MAX = 2000
UNSAFE_URL_CHARS = re.compile(r"[\s\"'`$]")
README_LINES = 60


class LaunchError(Exception):
    pass


def log(msg: str) -> None:
    print(f"{datetime.now().isoformat(timespec='seconds')} {msg}", flush=True)


def lockin_bin() -> str:
    cand = Path(sys.executable).with_name("lockin")
    return str(cand) if cand.exists() else "lockin"


def _job_context(db, o: dict, payload: dict) -> tuple[str, dict | None]:
    job_url = o.get("job_url") or payload.get("job_url") or ""
    posting = next(iter(db.select("postings", {"url": job_url})), None) if job_url else None
    return job_url, posting


def build_outreach(db, payload: dict, lockin: str, find=resume.find_resume) -> tuple[Path, str]:
    oid = payload.get("outreach_id")
    rows = db.select("outreach", {"id": oid}) if oid else []
    if not rows:
        raise LaunchError(f"outreach {oid!r} not found")
    o = rows[0]
    job_url, posting = _job_context(db, o, payload)
    display_company = o.get("company") or (posting or {}).get("company")
    match_company = display_company or resume.company_from_url(job_url)
    settings = (db.select("settings") or [{}])[0]
    role = o.get("role") or (posting or {}).get("title") or payload.get("role") or None
    choice = find(settings.get("resume_root") or DEFAULT_ROOT, match_company, role=role)
    patch = {"resume_path": str(choice.path)}
    if display_company and not o.get("company"):
        patch["company"] = display_company
    if posting and not o.get("role") and posting.get("title"):
        patch["role"] = posting["title"]
    db.update("outreach", {"id": oid}, patch)
    text = prompts.render(prompts.load("outreach"), {
        "outreach_id": oid, "job_url": job_url,
        "company": display_company or match_company or "unknown (read it from the posting)",
        "resume_path": str(choice.path), "resume_note": choice.note, "lockin": shlex.quote(lockin),
        **profile.prompt_values(settings.get("profile")),
    })
    OUTREACH_DIR.mkdir(parents=True, exist_ok=True)
    OUTREACH_DIR.chmod(0o700)
    return OUTREACH_DIR, text


def build_suggest(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    pid = payload.get("project_id")
    rows = db.select("projects", {"id": pid}) if pid else []
    if not rows:
        raise LaunchError(f"project {pid!r} not found")
    p = rows[0]
    if not p.get("local_path"):
        raise LaunchError(f"project {p['name']} has no local folder; set local_path in Settings")
    cwd = Path(os.path.expanduser(p["local_path"]))
    if not cwd.is_dir():
        raise LaunchError(f"{cwd} doesn't exist on this Mac")
    text = prompts.render(prompts.load("suggest_ideas"), {
        "project_id": pid, "project_name": p["name"], "repo": p["repo"],
        "lockin": shlex.quote(lockin)})
    return cwd, text




def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()[:40]).strip("-")
    return s or "idea"


def readme_head(cwd: Path, lines: int = README_LINES) -> str:
    p = cwd / "README.md"
    if not p.is_file():
        return "No README."
    return "\n".join(p.read_text(encoding="utf-8", errors="replace").splitlines()[:lines])


def build_work(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    iid = payload.get("idea_id")
    rows = db.select("ideas", {"id": iid}) if iid else []
    if not rows:
        raise LaunchError(f"idea {iid!r} not found")
    idea = rows[0]
    if idea.get("status") != "in_progress":
        raise LaunchError("Idea is no longer in progress")
    prow = db.select("projects", {"id": idea["project_id"]})
    p = prow[0] if prow else None
    cwd = Path(os.path.expanduser(p["local_path"])) if p and p.get("local_path") else None
    if cwd is None or not cwd.is_dir():
        raise LaunchError("Project folder not found")
    text = prompts.render(prompts.load("work_on_idea"), {
        "project_name": p["name"], "repo": p.get("repo") or "no GitHub repo yet",
        "idea_text": idea["text"], "idea_size": idea.get("size") or "S",
        # Ideas saved before migration 0007, or added by hand, have no details: the title is all there is.
        "idea_details": idea.get("details") or "None beyond the title above.",
        "readme": readme_head(cwd), "branch": f"idea/{slugify(idea['text'])}",
    })
    return cwd, text


def revert_work(db, payload: dict) -> None:
    iid = payload.get("idea_id")
    if iid:
        # Only undo our own start: leave it alone if Adam already finished or reset it.
        db.update("ideas", {"id": iid, "status": "in_progress"},
                  {"status": payload.get("prev_status") or "todo", "started_at": None})


def format_stories(stories: list[dict]) -> str:
    if not stories:
        return "No stories saved yet."
    out = []
    for s in stories:
        tags = f" ({', '.join(s.get('tags') or [])})" if s.get("tags") else ""
        out.append("\n".join([
            f"### {s['title']}{tags}",
            f"- Situation: {s.get('situation') or '-'}",
            f"- Task: {s.get('task') or '-'}",
            f"- Action: {s.get('action') or '-'}",
            f"- Result: {s.get('result') or '-'}",
        ]))
    return "\n\n".join(out)


def build_mock(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    mode = payload.get("mode")
    if mode not in ("behavioral", "technical"):
        raise LaunchError(f"unknown mock mode {mode!r}")
    company = (payload.get("company") or "").strip() or None
    notes = ""
    if company:
        hit = [r for r in db.select("company_prep") if (r.get("company") or "").strip().lower() == company.lower()]
        notes = (hit[0].get("notes") or "") if hit else ""
    stories = sorted(db.select("stories"), key=lambda s: str(s.get("created_at") or ""))
    text = prompts.render(prompts.load("mock_interview"), {
        "mode": mode, "company": company or "no specific company", "company_notes": notes or "None yet.",
        "stories": format_stories(stories), "lockin": shlex.quote(lockin),
    })
    MOCK_DIR.mkdir(parents=True, exist_ok=True)
    MOCK_DIR.chmod(0o700)
    return MOCK_DIR, text


def folder_hint(company: str | None, role: str | None) -> str:
    """`<Company>_<Role words>` the way Adam names resume folders: ASCII letters/digits joined by single underscores."""
    raw = " ".join(x for x in (company, role) if x)
    hint = "_".join(re.findall(r"[A-Za-z0-9]+", raw))[:FOLDER_HINT_MAX].strip("_")
    return hint or "Tailored_Resume"


def safe_job_url(url) -> str:
    """The posting link goes into a shell command Claude runs, so only plain http(s) URLs get through."""
    ok = isinstance(url, str) and 0 < len(url) <= JOB_URL_MAX and not UNSAFE_URL_CHARS.search(url)
    if ok:
        u = urlparse(url)
        ok = u.scheme in ("http", "https") and bool(u.netloc)
    if not ok:
        raise LaunchError("Job link isn't a plain http(s) URL")
    return url


ICLOUD_MSG = ("Base resume is in iCloud and couldn't be downloaded \u2014 open Base_Resume in Finder once "
              "(or right-click \u2192 Keep Downloaded), then Try again")
ICLOUD_RUN = subprocess.run  # injectable for tests, like resume.ensure_local's run/sleep
ICLOUD_SLEEP = time.sleep
COPY_ATTEMPTS = 3
COPY_RETRY_DELAY = 1.0


def _is_file(p: Path) -> bool:
    try:
        return p.is_file()
    except OSError:
        return False


def _copy_base(src: Path, dst: Path) -> None:
    """Copy from iCloud-synced storage; evicted files fail with EDEADLK/ETIMEDOUT until downloaded."""
    for attempt in range(COPY_ATTEMPTS):
        try:
            shutil.copyfile(src, dst)
            return
        except OSError as e:
            if e.errno not in (errno.EDEADLK, errno.ETIMEDOUT):
                raise
            if attempt == COPY_ATTEMPTS - 1:
                raise LaunchError(ICLOUD_MSG) from e
            ICLOUD_SLEEP(COPY_RETRY_DELAY)
            resume.ensure_local(src, ICLOUD_RUN, ICLOUD_SLEEP, force=True)


OPEN_RUN = subprocess.run  # injectable for tests: opens the posting / reveals the resume without Claude


def _created_ts(o: dict) -> float:
    """The outreach row's creation time, so only resumes saved for this card count. 0 when unknown."""
    try:
        return datetime.fromisoformat(str(o.get("created_at")).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def find_tailored(o: dict, root: Path, hint: str) -> Path | None:
    """A tailored PDF already saved for this card: its resume_path, or a `<hint>` / `<hint>_N` folder saved since."""
    since = _created_ts(o)

    def fresh(pdf: Path) -> bool:
        try:
            return pdf.is_file() and pdf.parent.name != BASE_RESUME and pdf.stat().st_mtime >= since
        except OSError:
            return False

    saved = o.get("resume_path")
    if saved and fresh(Path(os.path.expanduser(saved))):
        return Path(os.path.expanduser(saved))
    try:
        dirs = [d for d in root.iterdir() if d.is_dir() and re.fullmatch(re.escape(hint) + r"(_\d+)?", d.name)]
    except OSError:
        return None
    pdfs = [d / f"{RESUME_STEM}.pdf" for d in dirs]
    pdfs = [p for p in pdfs if fresh(p)]
    return max(pdfs, key=lambda p: p.stat().st_mtime) if pdfs else None


def build_tailor(db, payload: dict, lockin: str, find=None) -> tuple[Path, str] | tuple[Path, str, dict] | dict:
    oid = payload.get("outreach_id")
    rows = db.select("outreach", {"id": oid}) if oid else []
    if not rows:
        raise LaunchError(f"outreach {oid!r} not found")
    o = rows[0]
    job_url, posting = _job_context(db, o, payload)
    safe_job_url(job_url)
    company = o.get("company") or (posting or {}).get("company")
    role = o.get("role") or (posting or {}).get("title") or None
    settings = (db.select("settings") or [{}])[0]
    root = Path(os.path.expanduser(settings.get("resume_root") or DEFAULT_ROOT))
    hint = folder_hint(company or resume.company_from_url(job_url), role)
    if payload.get("retailor"):
        done = find_tailored(o, root, hint)
        if done is not None:
            # Already tailored: no Claude run, just record it, show it in Finder and reopen the posting.
            if o.get("resume_path") != str(done):
                db.update("outreach", {"id": oid}, {"resume_path": str(done)})
            OPEN_RUN(["open", "-R", str(done)], check=False)
            OPEN_RUN(["open", job_url], check=False)
            log(f"retailor {oid}: resume already at {done}")
            return {"result": "reused"}
    base_dir = root / BASE_RESUME
    base_tex, base_pdf = base_dir / f"{RESUME_STEM}.tex", base_dir / f"{RESUME_STEM}.pdf"
    for base in (base_tex, base_pdf):
        resume.ensure_local(base, ICLOUD_RUN, ICLOUD_SLEEP)
        if not _is_file(base):
            if _is_file(base.with_name(f".{base.name}.icloud")):
                raise LaunchError(ICLOUD_MSG)
            raise LaunchError(f"Base resume not found at {base} (check the file exists and Terminal/Python has Desktop access)")
    patch = {}
    if company and not o.get("company"):
        patch["company"] = company
    if posting and not o.get("role") and posting.get("title"):
        patch["role"] = posting["title"]
    if patch:
        db.update("outreach", {"id": oid}, patch)
    TAILOR_DIR.mkdir(parents=True, exist_ok=True)
    TAILOR_DIR.chmod(0o700)
    work = TAILOR_DIR / f"{slugify(hint)}-{slugify(str(oid))[:8]}"
    work.mkdir(exist_ok=True)
    work.chmod(0o700)
    _copy_base(base_tex, work / f"{RESUME_STEM}.tex")
    fill = payload.get("fill_application") is True
    text = prompts.render(prompts.load("tailor_resume"), {
        **_apply_values(fill, job_url, settings.get("profile")),
        "outreach_id": oid, "job_url": job_url,
        "company": company or resume.company_from_url(job_url) or "unknown (read it from the posting)",
        "role": role or "unknown (read it from the posting)",
        "resume_root": str(root), "base_tex": str(base_tex), "base_pdf": str(base_pdf),
        "work_dir": str(work), "folder_hint": hint, "lockin": shlex.quote(lockin),
        **profile.prompt_values(settings.get("profile")),
    })
    return (work, text, {"chrome": True}) if fill else (work, text)


NO_ANSWERS = "(none set on the Me tab: leave those questions blank and list them for Adam)"


def _apply_values(fill: bool, job_url: str, saved_profile: dict | None) -> dict:
    """The parts of the tailor prompt that differ when Claude also fills in the application in Chrome."""
    if not fill:
        return {"open_step": f"6. Open the posting for Adam so he can apply: `open {shlex.quote(job_url)}`",
                "apply_part": "", "form_rule": "Never apply or fill in forms. Draft only."}
    answers = profile.merged(saved_profile).get("application") or NO_ANSWERS
    part = prompts.render(prompts.load("fill_application"), {
        "job_url": job_url, "job_url_shell": shlex.quote(job_url), "application_answers": answers,
    })
    return {"open_step": "6. Don't run `open` on the posting here: Part 1b opens it in Chrome.",
            "apply_part": part,
            "form_rule": "Never submit an application. Fill in the form in Chrome only as Part 1b says, and leave Submit for Adam."}


def _write_json(path: Path, rows) -> None:
    path.write_text(json.dumps(rows, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    path.chmod(0o600)


def build_best_fit(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    """Find best fits: hand Claude the inbox, the applications and the dismissed postings as JSON files."""
    settings = (db.select("settings") or [{}])[0]
    postings = db.select("postings")
    by_new = sorted(postings, key=lambda p: str(p.get("found_at") or ""), reverse=True)
    inbox = [{k: p.get(k) for k in ("id", "company", "title", "location", "term", "tier", "url", "posted_at")}
             for p in by_new if p.get("status") in ("new", "seen")]
    if not inbox:
        raise LaunchError("The Jobs inbox is empty; wait for the next scan, then try again")
    applied = [{k: a.get(k) for k in ("company", "role", "track", "term", "location", "stage", "applied_on")}
               for a in sorted(db.select("applications"), key=lambda a: str(a.get("applied_on") or ""), reverse=True)]
    applied += [{"company": p["company"], "role": p["title"], "stage": "emailing a recruiter", "url": p.get("url")}
                for p in by_new if p.get("status") == "outreach"]
    passed = [{"company": p["company"], "title": p["title"]} for p in by_new if p.get("status") == "dismissed"][:PASSED_MAX]
    BEST_FIT_DIR.mkdir(parents=True, exist_ok=True)
    BEST_FIT_DIR.chmod(0o700)
    for name, rows in (("inbox.json", inbox), ("applied.json", applied), ("passed.json", passed)):
        _write_json(BEST_FIT_DIR / name, rows)
    base_dir = Path(os.path.expanduser(settings.get("resume_root") or DEFAULT_ROOT)) / BASE_RESUME
    text = prompts.render(prompts.load("best_fit"), {
        "work_dir": str(BEST_FIT_DIR), "n_inbox": str(len(inbox)), "n_applied": str(len(applied)),
        "n_passed": str(len(passed)), "base_tex": str(base_dir / f"{RESUME_STEM}.tex"),
        "base_pdf": str(base_dir / f"{RESUME_STEM}.pdf"), "lockin": shlex.quote(lockin),
        **profile.prompt_values(settings.get("profile")),
    })
    return BEST_FIT_DIR, text


# Make PDF report: every table Claude needs, one JSON file each. problems is global and big, so only solved ones go in.
REPORT_TABLES = ("lc_solves", "lc_problem_state", "lc_topic_state", "lc_daily_sets", "topics", "applications",
                 "postings", "outreach", "contacts", "referrals", "projects", "commits", "ideas", "stories", "prep_sessions",
                 "prep_items", "prep_progress", "company_prep", "events",
                 "learn_modules", "learn_items", "learn_progress", "learn_module_state", "learn_checks")
REPORT_DROP = {"owner", "row_hash"}  # bookkeeping columns, not Adam's data
SETTINGS_PRIVATE = {"ntfy_topic", "sheet_id"}  # anyone holding these can push nudges or find the Sheet


def _clean(rows: list[dict]) -> list[dict]:
    return [{k: v for k, v in r.items() if k not in REPORT_DROP} for r in rows]


def build_report(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    """Make PDF report: dump everything to JSON in a dated work folder and brief Claude to build the PDF."""
    settings = (db.select("settings") or [{}])[0]
    stamp = datetime.now().strftime("%Y-%m-%d")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.chmod(0o700)
    work = REPORT_DIR / stamp
    data = work / "data"
    data.mkdir(parents=True, exist_ok=True)
    work.chmod(0o700)
    counts: dict[str, int] = {}
    for table in REPORT_TABLES:
        rows = _clean(db.select(table))
        counts[table] = len(rows)
        _write_json(data / f"{table}.json", rows)
    solved = {s.get("slug") for s in db.select("lc_solves")}
    _write_json(data / "problems.json", [p for p in db.select("problems") if p.get("slug") in solved])
    p = profile.merged(settings.get("profile"))
    lc_user = settings.get("lc_username")
    links = {
        "github": p.get("github") or None, "linkedin": p.get("linkedin") or None, "portfolio": p.get("portfolio") or None,
        "leetcode": f"https://leetcode.com/u/{lc_user}/" if lc_user else None,
        "projects": [{"name": x.get("name"), "url": f"https://github.com/{x['repo']}"}
                     for x in db.select("projects") if x.get("repo")],
    }
    _write_json(data / "profile.json", {"profile": p, "links": links,
                                        "settings": {k: v for k, v in _clean([settings])[0].items()
                                                     if k not in SETTINGS_PRIVATE and k != "profile"}})
    root = Path(os.path.expanduser(settings.get("resume_root") or DEFAULT_ROOT))
    base_dir = root / BASE_RESUME
    tailored = sorted({str(o["resume_path"]) for o in db.select("outreach")
                       if o.get("resume_path") and f"/{BASE_RESUME}/" not in str(o["resume_path"])})
    _write_json(data / "resumes.json", {"base_tex": str(base_dir / f"{RESUME_STEM}.tex"),
                                       "base_pdf": str(base_dir / f"{RESUME_STEM}.pdf"), "tailored": tailored})
    out_dir = root / "Reports"
    text = prompts.render(prompts.load("report"), {
        "work_dir": str(work), "data_dir": str(data), "today": stamp,
        "counts": "\n".join(f"- `{t}.json`: {n} rows" for t, n in counts.items()),
        "base_tex": str(base_dir / f"{RESUME_STEM}.tex"), "base_pdf": str(base_dir / f"{RESUME_STEM}.pdf"),
        "out_dir": str(out_dir), "out_pdf": str(out_dir / f"Lock_In_Report_{stamp}.pdf"),
        "links": "\n".join(f"- {k}: {v}" for k, v in links.items() if k != "projects" and v) or "- (none set on the Me tab)",
        **profile.prompt_values(settings.get("profile")),
    })
    return work, text


ENGINEERS_DIR = Path.home() / ".lockin" / "engineers"  # Find engineers runs here, not in $HOME
REFERRAL_STATUS = {"drafted": "note drafted, not sent", "sent": "note sent", "accepted": "connected",
                   "replied": "replied", "referred": "referred Adam", "closed": "closed"}
FIT_WITH_POSTING = """Read the posting (fetch the URL). If it won't load, say so in one line and skip this check. Adam is NOT a fit if the posting clearly:
- is only for PhD or Master's students or graduates ("Bachelor's or Master's" is fine)
- needs a graduation date that neither {grad} nor {grad_late} fits
- asks for 2 or more years of full-time industry experience (internships or "0-2 years" are fine)
- needs an active security clearance, or isn't entry level (senior, staff, lead, manager)

Then do exactly one of these:
- **Clear fit:** say so in one line and go on.
- **Clearly not a fit:** stop. Tell Adam in two or three lines what rules him out, quoting the posting. Ask: "Want me to drop this from Lock In?" Only if he says yes, run `{lockin} skip-job --request {request_id} --reason "<one line, e.g. PhD required>"`. Then stop: no engineer search, no notes.
- **Unclear:** explain in two or three lines and ask Adam whether to continue. Wait for his answer."""
FIT_NO_POSTING = ("There's no posting link: Adam started this from an application he already sent. Skip the fit check. "
                  "If you need the team or stack, look the role up on {company}'s careers site.")


def _known_line(r: dict) -> str:
    who = r["name"] + (f" ({r['title']})" if r.get("title") else "")
    role = f", {r['role']}" if r.get("role") else ""
    return f"- {who}: {REFERRAL_STATUS.get(r.get('status'), r.get('status'))}{role}"


def build_engineers(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    """Find engineers: one or two people at the company to ask for a referral, each with a LinkedIn note."""
    rid = payload.get("request_id")
    posting = None
    if payload.get("posting_id"):
        posting = next(iter(db.select("postings", {"id": payload["posting_id"]})), None)
    job_url = payload.get("job_url") or (posting or {}).get("url") or ""
    if job_url:
        safe_job_url(job_url)
    company = (payload.get("company") or (posting or {}).get("company") or "").strip()
    if not company:
        raise LaunchError("No company to search: open Find engineers from a job or an application")
    role = (payload.get("role") or (posting or {}).get("title") or "").strip() or "the role (read it from the posting)"
    tier = payload.get("tier") or (posting or {}).get("tier") or "reach"
    settings = (db.select("settings") or [{}])[0]
    values = profile.prompt_values(settings.get("profile"))
    key = tiers.company_key(company)
    known = [r for r in db.select("referrals") if tiers.company_key(r.get("company")) == key]
    already = "\n".join(_known_line(r) for r in known) or "- Nobody yet."
    fit = (FIT_WITH_POSTING.format(grad=values["grad"], grad_late=values["grad_late"], lockin=shlex.quote(lockin), request_id=rid)
           if job_url else FIT_NO_POSTING.format(company=company))
    text = prompts.render(prompts.load("find_engineers"), {
        "company": company, "role": role, "tier": tier, "job_url": job_url or "no link (already applied)",
        "already": already, "fit_step": fit, "request_id": str(rid), "lockin": shlex.quote(lockin), **values,
    })
    ENGINEERS_DIR.mkdir(parents=True, exist_ok=True)
    ENGINEERS_DIR.chmod(0o700)
    return ENGINEERS_DIR, text


LEARN_DIR = Path.home() / ".lockin" / "learn"  # Teach me / Check me run here (one folder per item for exercises)
TRACK_TITLE = {"cs": "CS", "math": "Math", "founder": "Founder"}
STATUS_WORD = {"not_started": "not started", "in_progress": "in progress", "done": "done"}
RATING_WORD = {"nailed": "nailed it", "struggled": "struggled", "help": "needed help"}


def _module(db, module_id) -> dict:
    rows = db.select("learn_modules", {"id": module_id}) if module_id else []
    if not rows:
        raise LaunchError(f"learning module {module_id!r} not found (has the worker synced shared/learning.json?)")
    return rows[0]


def _module_lines(db, module_id: str) -> str:
    progress = {r["item_id"]: r for r in db.select("learn_progress")}
    out = []
    for it in sorted(db.select("learn_items", {"module_id": module_id}), key=lambda r: r.get("ord") or 0):
        pr = progress.get(it["id"], {})
        rating = f", {RATING_WORD[pr['rating']]}" if pr.get("rating") in RATING_WORD else ""
        out.append(f"- [{it['type']}] {it['title']}: {STATUS_WORD.get(pr.get('status') or 'not_started')}{rating}"
                   + (f". {it['details']}" if it.get("details") else ""))
    return "\n".join(out) or "- (no items)"


def _learn_dir(name: str) -> Path:
    LEARN_DIR.mkdir(parents=True, exist_ok=True)
    LEARN_DIR.chmod(0o700)
    d = LEARN_DIR / slugify(name)
    d.mkdir(exist_ok=True)
    return d


def build_teach(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    """Teach me on one item: Socratic, Adam attempts first. Build items open in the project's folder when it's on this Mac."""
    rows = db.select("learn_items", {"id": payload.get("item_id")}) if payload.get("item_id") else []
    if not rows:
        raise LaunchError(f"learning item {payload.get('item_id')!r} not found")
    it = rows[0]
    m = _module(db, it["module_id"])
    pr = (db.select("learn_progress", {"item_id": it["id"]}) or [{}])[0]
    cwd = None
    if it.get("type") == "build" and it.get("project"):
        proj = next((p for p in db.select("projects") if (p.get("name") or "").lower() == it["project"].lower()), None)
        if proj and proj.get("local_path") and Path(os.path.expanduser(proj["local_path"])).is_dir():
            cwd = Path(os.path.expanduser(proj["local_path"]))
    cwd = cwd or _learn_dir(it["id"])
    settings = (db.select("settings") or [{}])[0]
    notes = (pr.get("notes") or "").strip()
    text = prompts.render(prompts.load("teach_item"), {
        "track": TRACK_TITLE.get(m["track"], m["track"]), "module_ord": str(m.get("ord")), "module_title": m["title"],
        "module_summary": m.get("summary") or "", "item_title": it["title"], "item_type": it["type"],
        "item_hours": f"{float(it.get('hours') or 0):g}", "item_url": it.get("url") or "none",
        "item_details": it.get("details") or "-", "item_status": STATUS_WORD.get(pr.get("status") or "not_started"),
        "item_rating": RATING_WORD.get(pr.get("rating"), "none yet"),
        "item_notes": "\n".join(f"  {line}" for line in notes.splitlines()) or "  (none)",
        "module_items": _module_lines(db, m["id"]), "work_dir": str(cwd), "item_id": it["id"], "lockin": shlex.quote(lockin),
        **profile.prompt_values(settings.get("profile")),
    })
    return cwd, text


def _build_quiz(template: str, db, payload: dict, lockin: str) -> tuple[Path, str]:
    m = _module(db, payload.get("module_id"))
    settings = (db.select("settings") or [{}])[0]
    past = sorted((c for c in db.select("learn_checks") if c.get("module_id") == m["id"]), key=lambda c: str(c.get("taken_on")))
    history = "\n".join(f"- {c['taken_on']} {c['kind']}: {c['score']}/{c['total']}, {RATING_WORD.get(c['rating'], c['rating'])}. "
                        f"{c.get('summary') or ''}".rstrip() for c in past) or "- None yet."
    text = prompts.render(prompts.load(template), {
        "track": TRACK_TITLE.get(m["track"], m["track"]), "module_ord": str(m.get("ord")), "module_title": m["title"],
        "module_summary": m.get("summary") or "", "module_items": _module_lines(db, m["id"]), "history": history,
        "request_id": str(payload.get("request_id")), "lockin": shlex.quote(lockin), **profile.prompt_values(settings.get("profile")),
    })
    return _learn_dir(m["id"]), text


def build_check(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    return _build_quiz("check_module", db, payload, lockin)


def build_review(db, payload: dict, lockin: str, find=None) -> tuple[Path, str]:
    return _build_quiz("review_module", db, payload, lockin)


BUILDERS = {"outreach": build_outreach, "suggest_ideas": build_suggest,
            "work_on_idea": build_work, "mock_interview": build_mock, "tailor_resume": build_tailor,
            "best_fit": build_best_fit, "report": build_report, "find_engineers": build_engineers,
            "teach_item": build_teach, "check_module": build_check, "review_module": build_review}
ON_FAIL = {"work_on_idea": revert_work}


def process(db, req: dict, opener, lockin: str, find=resume.find_resume) -> str:
    rid = req["id"]
    # Mark first: if anything below crashes, this request can never be opened twice.
    db.update("launch_requests", {"id": rid}, {"status": "launched", "error": None})
    try:
        builder = BUILDERS.get(req.get("kind"))
        if builder is None:
            raise LaunchError(f"unknown kind {req.get('kind')!r}")
        # The request id goes to the builder too: Find engineers saves against it (lockin save-engineers --request).
        built = builder(db, {**(req.get("payload") or {}), "request_id": rid}, lockin, find=find)
        if isinstance(built, dict):  # handled on the Mac without opening Claude; tell the app what happened
            db.update("launch_requests", {"id": rid}, {"payload": {**(req.get("payload") or {}), **built}})
            return "launched"
        cwd, text, *extra = built  # an optional third item: keyword options for the opener (chrome=True)
        opener(cwd, text, rid, **(extra[0] if extra else {}))
        log(f"launched {req['kind']} {rid} in {cwd}")
        return "launched"
    except Exception as exc:  # report every failure on the request itself
        msg = f"{type(exc).__name__}: {exc}"[:ERROR_MAX]
        log(f"failed {rid}: {msg}")
        db.update("launch_requests", {"id": rid}, {"status": "failed", "error": msg})
        hook = ON_FAIL.get(req.get("kind"))
        if hook:
            try:
                hook(db, req.get("payload") or {})
            except Exception as e2:  # the request is already marked failed; just log
                log(f"revert failed {rid}: {type(e2).__name__}: {e2}")

        return "failed"


def poll_once(db, opener, lockin: str, find=resume.find_resume) -> list[tuple[str, str]]:
    queued = sorted(db.select("launch_requests", {"status": "queued"}), key=lambda r: str(r.get("created_at") or ""))
    return [(r["id"], process(db, r, opener, lockin, find=find)) for r in queued]


def run_forever(make_db, opener, sleep=time.sleep, iterations: int | None = None, lockin: str | None = None,
                find=resume.find_resume) -> None:
    lockin = lockin or lockin_bin()
    db = None
    n = 0
    while iterations is None or n < iterations:
        n += 1
        try:
            if db is None:
                db = make_db()
            poll_once(db, opener, lockin, find=find)
        except Exception as exc:  # DB down, Keychain locked, network gone after sleep
            log(f"poll failed: {type(exc).__name__}: {exc}")
            if isinstance(exc, creds.CredsError):
                db = None
        sleep(POLL_SECONDS)


def main() -> None:
    log("lockin launcher started")
    run_forever(creds.make_db, terminal.open_in_terminal)


if __name__ == "__main__":
    main()
