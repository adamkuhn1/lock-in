from __future__ import annotations

import argparse
import plistlib
import sys
from pathlib import Path

LABEL = "com.adamkuhn.lockin.launcher"


def plist_dict(python: str, home: Path) -> dict:
    log = str(home / "Library" / "Logs" / "lockin-launcher.log")
    return {
        "Label": LABEL,
        "ProgramArguments": [python, "-m", "lockin_worker.launcher"],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 30,
        "StandardOutPath": log,
        "StandardErrorPath": log,
        "WorkingDirectory": str(home),
        "EnvironmentVariables": {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "PYTHONUNBUFFERED": "1"},
    }


def write_plist(path: Path, python: str, home: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(plistlib.dumps(plist_dict(python, home)))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m lockin_worker.install")
    ap.add_argument("--plist", required=True)
    args = ap.parse_args(argv)
    write_plist(Path(args.plist), sys.executable, Path.home())
    print(f"wrote {args.plist}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
