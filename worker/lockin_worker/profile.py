"""Adam's profile (settings.profile, edited on the Me tab) → the values the Claude prompts use.

Same rules as web/src/lib/profile.ts; shared/profile-cases.json keeps the two in step.
"""

from __future__ import annotations

import json
from pathlib import Path

SHARED = Path(__file__).resolve().parents[2] / "shared"
FIELDS = ("name", "school", "degree", "grad", "grad_late", "experience", "targets", "locations", "notes", "application",
          "github", "linkedin", "portfolio")


def defaults() -> dict:
    return json.loads((SHARED / "profile_defaults.json").read_text())


def merged(profile: dict | None) -> dict:
    """Defaults, overridden by every non-blank field Adam has set."""
    out = defaults()
    for k in FIELDS:
        v = (profile or {}).get(k)
        if isinstance(v, str) and v.strip():
            out[k] = " ".join(v.split())
    return out


def prompt_values(profile: dict | None) -> dict:
    p = merged(profile)
    later = p["grad_late"] if p["grad_late"] and p["grad_late"] != p["grad"] else ""
    lines = [f"- {p['school']}. {p['degree']}, graduating {p['grad']}."]
    if p["experience"]:
        lines.append(f"- {p['experience'].rstrip('.')}.")
    lines.append(f"- Looking for {p['targets'].rstrip('.')}." + (f" For the right role he will push graduation to {later}." if later else ""))
    if p["locations"]:
        lines.append(f"- Prefers {p['locations'].rstrip('.')}.")
    if p["notes"]:
        lines.append(f"- {p['notes'].rstrip('.')}.")
    return {"who": "\n".join(lines), "grad": p["grad"], "grad_late": p["grad_late"] or p["grad"], "targets": p["targets"]}
