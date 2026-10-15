from __future__ import annotations

import os
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_RELATIVE = Path("Base_Resume") / "Adam_Kuhn_Resume.pdf"
SUFFIXES = {"inc", "incorporated", "llc", "ltd", "co", "corp", "corporation", "company", "plc", "gmbh",
            "technologies", "technology", "labs", "group", "holdings"}
GENERIC_LABELS = {"www", "careers", "career", "jobs", "job", "apply", "boards", "en", "us"}
ATS_FIRST_PATH = ("greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com")


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def normalize_company(name: str) -> str:
    toks = _tokens(name or "")
    if toks and toks[0] == "the":
        toks = toks[1:]
    while len(toks) > 1 and toks[-1] in SUFFIXES:
        toks = toks[:-1]
    return "_".join(toks)


def folder_matches(folder_name: str, company_norm: str) -> bool:
    if not company_norm:
        return False
    ftoks = _tokens(folder_name)
    ctoks = company_norm.split("_")
    if ftoks[: len(ctoks)] == ctoks:
        return True
    compact = "".join(ctoks)
    return any("".join(ftoks[:k]) == compact for k in range(1, len(ftoks) + 1))


def company_from_url(url: str) -> str | None:
    u = urlparse(url or "")
    host = (u.hostname or "").lower()
    if not host or "." not in host:
        return None
    parts = [p for p in u.path.split("/") if p]
    if host.endswith(ATS_FIRST_PATH):
        if parts and parts[0] == "embed":
            return (parse_qs(u.query).get("for") or [None])[0]
        return parts[0] if parts else None
    if host.endswith(".myworkdayjobs.com"):
        return host.split(".")[0]
    labels = host.split(".")[:-1]  # drop the TLD
    labels = [x for x in labels if x not in GENERIC_LABELS]
    return labels[-1] if labels else None


def _real_name(p: Path) -> str | None:
    n = p.name
    if n.startswith(".") and n.endswith(".icloud"):
        return n[1:-len(".icloud")]  # iCloud placeholder for an evicted file
    return None if n.startswith(".") else n


def _resume_file(folder: Path) -> Path | None:
    entries = [(p, _real_name(p)) for p in folder.iterdir() if p.is_file()]
    for ext in (".pdf", ".tex"):
        cands = [(p, n) for p, n in entries if n and n.lower().endswith(ext)]
        if cands:
            _, name = max(cands, key=lambda t: t[0].stat().st_mtime)
            return folder / name
    return None


def _exists(path: Path) -> bool:
    try:
        return path.exists()
    except OSError:
        return False  # e.g. PermissionError (macOS TCC) is not swallowed by Path.exists


SF_DATALESS = 0x40000000  # macOS: iCloud-evicted file; it exists but reads fail with EDEADLK
STAT = os.stat  # injectable for tests


def is_dataless(path: Path, stat=None) -> bool:
    try:
        st = (stat or STAT)(path)
    except OSError:
        return False
    return bool(getattr(st, "st_flags", 0) & SF_DATALESS)


def ensure_local(path: Path, run=subprocess.run, sleep=time.sleep,
                 wait: float = 15.0, interval: float = 0.5, force: bool = False, stat=None) -> bool:
    """Best-effort `brctl download`, then poll: brctl returns before the file lands.

    Downloads when the file is missing (placeholder), dataless, or `force` is set."""
    try:
        if path.exists() and not force and not is_dataless(path, stat):
            return True
    except PermissionError:
        return False  # macOS TCC denial: brctl and polling can't fix it
    except OSError:
        pass
    try:
        run(["brctl", "download", str(path)], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError):
        return _ready(path, stat)  # brctl missing or timed out: nothing to wait for
    for _ in range(int(wait / interval)):
        if _ready(path, stat):
            return True
        sleep(interval)
    return _ready(path, stat)


def _ready(path: Path, stat=None) -> bool:
    return _exists(path) and not is_dataless(path, stat)


@dataclass(frozen=True)
class ResumeChoice:
    path: Path
    note: str
    folder: Path | None


def _overlap(folder_name: str, role_toks: set[str]) -> int:
    return len(role_toks & set(_tokens(folder_name)))


def find_resume(root: Path | str, company: str | None, *, role: str | None = None,
                run=subprocess.run, sleep=time.sleep) -> ResumeChoice:
    root = Path(os.path.expanduser(str(root)))
    base = root / BASE_RELATIVE

    def fallback(note: str) -> ResumeChoice:
        if not ensure_local(base, run, sleep):
            note += f" The base resume at {base} couldn't be read either."
        return ResumeChoice(base, note, None)

    comp = normalize_company(company or "")
    if not comp:
        return fallback("Company unknown, so no tailored resume was matched. Using the base resume.")
    role_toks = set(_tokens(role or "")) - set(comp.split("_"))
    try:
        folders = [p for p in root.iterdir()
                   if p.is_dir() and p.name != "Base_Resume" and folder_matches(p.name, comp)]
        mtimes = {p: p.stat().st_mtime for p in folders}
    except OSError as e:
        return fallback(f"Couldn't read {root} ({e.strerror or type(e).__name__}). Using the base resume; "
                        f"check that folder for a {company} resume yourself.")
    if not folders:
        return fallback(f"No resume folder for {company} under {root}. Using the base resume.")
    if role is None:
        folders.sort(key=lambda p: mtimes[p], reverse=True)
    else:
        folders.sort(key=lambda p: (_overlap(p.name, role_toks), mtimes[p]), reverse=True)
    chosen = folders[0]
    try:
        f = _resume_file(chosen)
    except OSError as e:
        return fallback(f"Couldn't read {chosen} ({type(e).__name__}). Using the base resume.")
    if f is None:
        return fallback(f"{chosen.name} has no .pdf or .tex. Using the base resume.")
    if not ensure_local(f, run, sleep):
        return fallback(f"{f} is in iCloud and couldn't be downloaded. Using the base resume.")
    note = f"Matched resume folder {chosen.name}."
    if len(folders) > 1:
        others = ", ".join(p.name for p in folders[1:])
        note += f" Other matches ({'best fit' if role is not None else 'newest'} first; use one of these instead if it fits the posting better): {others}."
    return ResumeChoice(f, note, chosen)
