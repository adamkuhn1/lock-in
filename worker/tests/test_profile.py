import json
from pathlib import Path

import pytest

from lockin_worker import profile

CASES = json.loads((Path(__file__).resolve().parents[2] / "shared" / "profile-cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_prompt_values_match_shared_cases(case):
    assert profile.prompt_values(case["profile"]) == case["out"]


def test_none_profile_is_defaults():
    assert profile.prompt_values(None) == profile.prompt_values({})
