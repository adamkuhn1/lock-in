from __future__ import annotations

import os
import re
import shlex
import subprocess
import time
from pathlib import Path

PROMPT_DIR = Path.home() / "Library" / "Caches" / "lockin" / "prompts"
KEEP_DAYS = 7


class TerminalError(Exception):
    pass


def write_prompt(text: str, name: str, directory: Path = PROMPT_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    cutoff = time.time() - KEEP_DAYS * 86400
    for old in directory.glob("lockin-prompt-*.md"):
        if old.stat().st_mtime < cutoff:
            old.unlink(missing_ok=True)
    safe = re.sub(r"[^A-Za-z0-9-]", "", name) or "prompt"
    path = directory / f"lockin-prompt-{safe}.md"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    path.chmod(0o600)  # an existing file keeps its old mode through O_CREAT
    return path


def shell_command(cwd: Path, prompt_file: Path, program: str = "claude") -> str:
    # `program` is a trusted constant; everything that varies is quoted.
    return f'cd {shlex.quote(str(cwd))} && {program} "$(cat {shlex.quote(str(prompt_file))})"'


def applescript_string(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def osascript_argv(command: str) -> list[str]:
    return ["osascript", "-e", 'tell application "Terminal"',
            "-e", f"do script {applescript_string(command)}",
            "-e", "activate", "-e", "end tell"]


def open_in_terminal(cwd: Path, prompt: str, name: str, run=subprocess.run,
                     directory: Path = PROMPT_DIR, chrome: bool = False) -> Path:
    """chrome=True starts Claude with Claude in Chrome turned on (filling in an application)."""
    f = write_prompt(prompt, name, directory)
    program = "claude --chrome" if chrome else "claude"
    r = run(osascript_argv(shell_command(cwd, f, program)), capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise TerminalError(f"osascript failed ({r.returncode}): {(r.stderr or '').strip()[:300]}")
    return f
