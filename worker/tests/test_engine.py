from datetime import date, timedelta

import pytest

from lockin_worker.engine import PARK_DAYS, ProblemState, apply_rating

D = date(2026, 10, 14)


def test_solo_medium_ladder():
    p = ProblemState("a")
    seen = []
    for _ in range(6):
        p = apply_rating(p, "solo", D)
        seen.append(p.interval_days)
    assert seen == [3, 7, 21, 60, 120, 120]
    assert p.state == "retained" and p.due_on == D + timedelta(days=120)


def test_solo_below_60_is_reviewing():
    p = apply_rating(ProblemState("a", "reviewing", 7), "solo", D)
    assert (p.state, p.interval_days) == ("reviewing", 21)


def test_easy_solved_solo_first_try_is_retained_not_reviewed():
    p = apply_rating(ProblemState("e"), "solo", D, "Easy")
    assert (p.state, p.interval_days, p.due_on) == ("retained", 60, D + timedelta(days=60))


def test_easy_solved_solo_after_a_miss_climbs_the_ladder():
    p = apply_rating(ProblemState("e", "learning", 3, lapses=1), "solo", D, "Easy")
    assert (p.state, p.interval_days, p.lapses) == ("reviewing", 7, 0)


@pytest.mark.parametrize("rating", ["explained", "codealong"])
def test_miss_comes_back_in_3_days(rating):
    p = apply_rating(ProblemState("a", "reviewing", 21), rating, D)
    assert (p.state, p.interval_days, p.due_on, p.lapses) == ("learning", 3, D + timedelta(days=3), 1)


def test_second_miss_in_a_row_parks_for_3_weeks():
    p = apply_rating(ProblemState("a"), "codealong", D)
    p = apply_rating(p, "explained", D + timedelta(days=3))
    assert p.state == "parked" and p.due_on == D + timedelta(days=3 + PARK_DAYS)


def test_solo_unparks_and_resets_misses():
    p = apply_rating(ProblemState("a", "parked", 3, D, lapses=2), "solo", D)
    assert (p.state, p.interval_days, p.lapses) == ("reviewing", 7, 0)
    assert apply_rating(p, "codealong", D).state == "learning"  # one miss after a solo doesn't park


def test_unknown_rating_rejected():
    with pytest.raises(ValueError):
        apply_rating(ProblemState("a"), "nailed", D)
