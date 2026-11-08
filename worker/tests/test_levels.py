import json
from datetime import date
from pathlib import Path

import pytest

from lockin_worker.levels import Attempt, Pools, progress, topic_level

CASES = json.loads((Path(__file__).parents[2] / "shared" / "mastery_cases.json").read_text())["cases"]


def _attempts(case):
    return [Attempt(a["slug"], "T", a["difficulty"], a["rating"], date.fromisoformat(a["on"]), a["slot"]) for a in case["attempts"]]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_mastery_cases(case):
    pools = Pools(**case["pools"])
    attempts = _attempts(case)
    p = progress(attempts, pools)
    exp = case["expect"]
    assert topic_level(attempts=attempts, pools=pools, prereq_levels=case["prereqs"]) == exp["level"]
    assert (p.easy_cleared, list(p.first_tries), p.medium_solo, p.hards_tried) == (
        exp["easyCleared"], exp["firstTries"], exp["mediumSolo"], exp["hardsTried"])


def test_same_day_new_attempt_sorts_before_review():
    # a review and the first try on one day: the first try is the one that counts
    d = date(2026, 11, 1)
    attempts = [Attempt("m", "T", "Medium", "solo", d, "review"), Attempt("m", "T", "Medium", "codealong", d, "new")]
    assert progress(attempts, Pools(0, 5, 0)).first_tries == ("codealong",)


def test_easy_cleared_capped_at_pool():
    # paid or retired problems solved outside the bank can't push past 100%
    attempts = [Attempt(f"e{i}", "T", "Easy", "solo", date(2026, 10, 1)) for i in range(5)]
    assert progress(attempts, Pools(3, 0, 0)).easy_cleared == 3
