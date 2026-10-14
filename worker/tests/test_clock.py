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
