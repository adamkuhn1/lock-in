from __future__ import annotations

import os
import re
from pathlib import Path

PLACEHOLDER = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
REPO_ROOT = Path(__file__).resolve().parents[2]


class TemplateError(Exception):
    pass


def prompts_dir() -> Path:
    return Path(os.environ.get("LOCKIN_PROMPTS_DIR") or REPO_ROOT / "prompts")


def placeholders(template: str) -> set[str]:
    return set(PLACEHOLDER.findall(template))


def render(template: str, values: dict[str, str]) -> str:
    missing = placeholders(template) - values.keys()
    if missing:
        raise TemplateError(f"missing values for: {', '.join(sorted(missing))}")
    return PLACEHOLDER.sub(lambda m: str(values[m.group(1)]), template)


def load(name: str) -> str:
    return (prompts_dir() / f"{name}.md").read_text(encoding="utf-8")
