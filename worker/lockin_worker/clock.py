from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Detroit")
PLAN_DAY_START_HOUR = 4


def now() -> datetime:
    return datetime.now(tz=TZ)


def local_day(ts: datetime) -> date:
    return ts.astimezone(TZ).date()


def plan_day(now_: datetime) -> date:
    return local_day(now_ - timedelta(hours=PLAN_DAY_START_HOUR))


def from_epoch(seconds: int | str) -> datetime:
    return datetime.fromtimestamp(int(seconds), tz=timezone.utc)


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))
