from datetime import date, timedelta
import pytest
from lockin_worker.engine import ProblemState, apply_rating

D = date(2026, 10, 14)

def test_nailed_ladder():
    p = ProblemState("a")
    seen = []
    for _ in range(6):
        p = apply_rating(p, "nailed", D)
        seen.append(p.interval_days)
    assert seen == [3, 7, 21, 60, 120, 120]
    assert p.state == "retained" and p.due_on == D + timedelta(days=120)

def test_nailed_below_60_is_reviewing():
    p = apply_rating(ProblemState("a", interval_days=7), "nailed", D)
    assert (p.state, p.interval_days) == ("reviewing", 21)

def test_help_resets_and_counts_lapse():
    p = apply_rating(ProblemState("a", state="reviewing", interval_days=21), "help", D)
    assert (p.state, p.interval_days, p.lapses, p.due_on) == ("learning", 1, 1, D + timedelta(days=1))

def test_struggled_grows_slowly_but_always_grows():
    assert apply_rating(ProblemState("a"), "struggled", D).interval_days == 1
    assert apply_rating(ProblemState("a", interval_days=1), "struggled", D).interval_days == 2
    assert apply_rating(ProblemState("a", interval_days=7), "struggled", D).interval_days == 8
    assert apply_rating(ProblemState("a", interval_days=21), "struggled", D).interval_days == 25
    assert apply_rating(ProblemState("a", interval_days=21), "struggled", D).state == "reviewing"

def test_parked_after_three_lapses():
    p = ProblemState("a", lapses=2)
    p = apply_rating(p, "help", D)
    assert (p.state, p.due_on) == ("parked", D + timedelta(days=14))

def test_nailed_unparks():
    p = apply_rating(ProblemState("a", state="parked", lapses=3, interval_days=1), "nailed", D)
    assert p.state == "reviewing" and p.interval_days == 3

def test_bad_rating():
    with pytest.raises(ValueError):
        apply_rating(ProblemState("a"), "meh", D)
