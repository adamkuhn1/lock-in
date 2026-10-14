from __future__ import annotations

import argparse
import os
from datetime import datetime
import sys
from pathlib import Path

from . import state as state_mod
from .config import ConfigError, load_companies, load_filters, load_lists
from .http import make_session
from .notify import Notifier
from .posted import ET, posted_line
from .radar import build_sources, recent, run


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="job_radar", description="Poll job boards and alert via ntfy.")
    parser.add_argument("--root", type=Path, default=Path("."), help="repo root (config/ and data/)")
    parser.add_argument("--dry-run", action="store_true", help="print alerts instead of sending; state is still written")
    parser.add_argument("--no-save", action="store_true", help="don't write data/seen.json")
    parser.add_argument("--recent", type=int, metavar="N",
                        help="one-off: send the N most recently posted matching jobs (state untouched)")
    args = parser.parse_args(argv)

    try:
        companies = load_companies(args.root / "config/companies.yaml")
        lists = load_lists(args.root / "config/lists.yaml")
        filters = load_filters(args.root / "config/filters.yaml")
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 2

    session = make_session()
    try:
        notifier = Notifier(os.environ.get("NTFY_TOPIC"), session=session, dry_run=args.dry_run)
    except ValueError as exc:
        print(f"error: {exc} (use --dry-run to test without it)", file=sys.stderr)
        return 2

    if args.recent:
        now = datetime.now(tz=ET)
        jobs = recent(now=now, sources=build_sources(companies, lists), filters=filters,
                      notifier=notifier, n=args.recent, session=session, log=lambda *_: None)
        for i, j in enumerate(jobs, 1):
            print(f"{i:2}. {j.company} — {j.title} | {j.location}\n    {posted_line(j, now)}\n    {j.url}")
        return 0

    seen_path = args.root / "data/seen.json"
    state = state_mod.load(seen_path)
    summary = run(sources=build_sources(companies, lists), filters=filters, state=state,
                  notifier=notifier, session=session)
    if not args.no_save:
        state_mod.save(state, seen_path)
    return 1 if summary["notify_failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
