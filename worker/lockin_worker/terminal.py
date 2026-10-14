from __future__ import annotations

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
    cutoff = time.time() - KEEP_DAYS * 86400
    for old in directory.glob("lockin-prompt-*.md"):
        if old.stat().st_mtime < cutoff:
            old.unlink(missing_ok=True)
    safe = re.sub(r"[^A-Za-z0-9-]", "", name) or "prompt"
    path = directory / f"lockin-prompt-{safe}.md"
    path.write_text(text, encoding="utf-8")
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
                     directory: Path = PROMPT_DIR) -> Path:
    f = write_prompt(prompt, name, directory)
    r = run(osascript_argv(shell_command(cwd, f)), capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        raise TerminalError(f"osascript failed ({r.returncode}): {(r.stderr or '').strip()[:300]}")
    return f
