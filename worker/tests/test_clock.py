from datetime import date, datetime, timezone
from lockin_worker import clock

def test_local_day_late_night_et():
    # 03:50 UTC on Oct 15 is 23:50 EDT on Oct 14
    ts = datetime(2026, 10, 15, 3, 50, tzinfo=timezone.utc)
    assert clock.local_day(ts) == date(2026, 10, 14)

def test_plan_day_before_4am_is_previous_day():
    ts = datetime(2026, 10, 15, 3, 30, tzinfo=clock.TZ)
    assert clock.plan_day(ts) == date(2026, 10, 14)

def test_plan_day_after_4am():
    ts = datetime(2026, 10, 15, 4, 0, tzinfo=clock.TZ)
    assert clock.plan_day(ts) == date(2026, 10, 15)

def test_from_epoch_string():
    assert clock.from_epoch("1791933659") == datetime.fromtimestamp(1791933659, tz=timezone.utc)

def test_parse_ts_roundtrip():
    ts = datetime(2026, 10, 14, 9, 0, tzinfo=clock.TZ)
    assert clock.parse_ts(ts.isoformat()) == ts
    assert clock.parse_ts("2026-10-14T13:00:00Z") == datetime(2026, 10, 14, 13, tzinfo=timezone.utc)


# I1: plan_day is instant arithmetic (instant - 4h, then Detroit date), DST-safe.
# Shared table with web/src/lib/time.test.ts.
import json
from pathlib import Path

import pytest

_CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "plan-day-cases.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", _CASES, ids=[c["instant"] for c in _CASES])
def test_plan_day_shared_cases_utc_and_local(case):
    utc = clock.parse_ts(case["instant"])
    expected = date.fromisoformat(case["plan_day"])
    assert clock.plan_day(utc) == expected
    assert clock.plan_day(utc.astimezone(clock.TZ)) == expected


def test_plan_day_naive_raises():
    with pytest.raises(ValueError):
        clock.plan_day(datetime(2026, 10, 15, 3, 30))
