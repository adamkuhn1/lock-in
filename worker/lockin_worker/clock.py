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
    # Instant arithmetic: subtract 4 h from the absolute instant (UTC), then take
    # the Detroit date. Wall-clock subtraction on an aware local datetime is wrong
    # across DST changes.
    if now_.tzinfo is None:
        raise ValueError("plan_day needs an aware datetime")
    return local_day(now_.astimezone(timezone.utc) - timedelta(hours=PLAN_DAY_START_HOUR))


def from_epoch(seconds: int | str) -> datetime:
    return datetime.fromtimestamp(int(seconds), tz=timezone.utc)


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))
