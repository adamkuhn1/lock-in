from __future__ import annotations

import os
import subprocess
from typing import Mapping

from .db import RestDB

SERVICE = "lockin"
ACCOUNTS = {
    "supabase_url": "LOCKIN_SUPABASE_URL",
    "service_key": "LOCKIN_SERVICE_KEY",
    "owner_id": "LOCKIN_OWNER_ID",
}


class CredsError(Exception):
    pass


def keychain_get(account: str, run=subprocess.run) -> str:
    item = f"Keychain item {SERVICE}/{account}"
    locked = f"{item} is locked or unreadable — unlock your login keychain"
    try:
        r = run(["security", "find-generic-password", "-s", SERVICE, "-a", account, "-w"],
                capture_output=True, text=True, timeout=20)
    except subprocess.TimeoutExpired:
        raise CredsError(f"{locked} (timed out).") from None
    value = (r.stdout or "").strip()
    if r.returncode == 44:
        raise CredsError(f"{item} is missing — run `make keychain` in the lock-in repo.")
    if r.returncode != 0 or not value:
        raise CredsError(f"{locked} (rc={r.returncode}).")
    return value


def get(account: str, env: Mapping | None = None, run=subprocess.run) -> str:
    env = os.environ if env is None else env
    override = (env.get(ACCOUNTS[account]) or "").strip()
    return override if override else keychain_get(account, run)


def make_db(env: Mapping | None = None, run=subprocess.run) -> RestDB:
    return RestDB(get("supabase_url", env, run), get("service_key", env, run), get("owner_id", env, run))
