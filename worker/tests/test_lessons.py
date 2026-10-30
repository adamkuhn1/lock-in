"""Every lesson in shared/lessons ships working: its reference solution passes its tests, its starter doesn't, and the
lesson stays short. Uses the same grader (shared/lessons/harness.py) that runs in the browser."""

import importlib.util
import json
import re
from pathlib import Path

import pytest

LESSONS = Path(__file__).resolve().parents[2] / "shared" / "lessons"
spec = importlib.util.spec_from_file_location("lesson_harness", LESSONS / "harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

MODULES = {m["id"] for t in json.loads((LESSONS.parent / "learning.json").read_text())["tracks"] for m in t["modules"]}
DIRS = sorted(p for p in LESSONS.glob("*/*") if p.is_dir())
MAX_WORDS = 900  # a lesson is a 10-15 minute read-and-do, not a chapter


def files(d: Path) -> dict:
    read = lambda name: (d / name).read_text(encoding="utf-8") if (d / name).exists() else ""
    return {"meta": json.loads(read("lesson.json")), "md": read("lesson.md"), "starter": read("starter.py"),
            "solution": read("solution.py"), "tests": read("tests.py"), "prelude": read("prelude.py")}


def test_there_are_lessons():
    assert DIRS


@pytest.mark.parametrize("d", DIRS, ids=lambda d: f"{d.parent.name}/{d.name}")
def test_lesson_shape(d):
    assert d.parent.name in MODULES, f"{d.parent.name} isn't a module in learning.json"
    assert re.fullmatch(r"\d\d-[a-z0-9-]+", d.name), "lesson folders are NN-slug"
    f = files(d)
    m = f["meta"]
    assert set(m) <= {"title", "minutes", "task", "hints", "quiz", "review"}, set(m)
    assert 0 < len(m["title"]) <= 60
    assert 5 <= m["minutes"] <= 20
    assert m["task"].strip()
    assert 1 <= len(m["hints"]) <= 4
    assert 1 <= len(m["quiz"]) <= 5, "1-5 quick checks, placed in the reading"
    assert 2 <= len(m["review"]) <= 5, "2-5 review questions for spaced review"
    for q in m["quiz"] + m["review"]:
        check_question(q)
    assert f["md"].strip(), "lesson.md is missing"
    # Each quick check sits in the reading, right after the section it tests: <!-- check N --> on its own line.
    marks = [int(n) for n in re.findall(r"^<!-- check (\d+) -->$", f["md"], re.M)]
    assert marks == list(range(1, len(m["quiz"]) + 1)), f"lesson.md needs <!-- check 1 --> .. <!-- check {len(m['quiz'])} --> in order, has {marks}"
    assert len(f["md"].split()) <= MAX_WORDS, f"lesson.md is {len(f['md'].split())} words; keep it under {MAX_WORDS}"
    for name in ("starter", "solution", "tests"):
        assert f[name].strip(), f"{name}.py is missing"


def check_question(q):
    """A question is multiple choice (options, exactly one correct, a why on each) or recall (accepted answers + why)."""
    assert q["q"].strip()
    if "options" in q:
        assert set(q) == {"q", "options"}, set(q)
        assert 2 <= len(q["options"]) <= 5
        assert sum(o["correct"] is True for o in q["options"]) == 1, q["q"]
        assert all(o["text"].strip() and o["why"].strip() for o in q["options"]), q["q"]
    else:
        assert set(q) == {"q", "answer", "why"}, set(q)
        assert q["answer"] and all(isinstance(a, str) and a.strip() for a in q["answer"]), q["q"]
        assert q["why"].strip()


@pytest.mark.parametrize("d", DIRS, ids=lambda d: f"{d.parent.name}/{d.name}")
def test_solution_passes(d):
    f = files(d)
    r = harness.grade(f["solution"], f["tests"], f["prelude"])
    assert r["error"] is None, r["error"]
    assert len(r["tests"]) >= 3, "write at least 3 tests"
    assert r["passed"], [t for t in r["tests"] if not t["ok"]]


@pytest.mark.parametrize("d", DIRS, ids=lambda d: f"{d.parent.name}/{d.name}")
def test_starter_runs_and_fails(d):
    f = files(d)
    r = harness.grade(f["starter"], f["tests"], f["prelude"])
    assert r["error"] is None, f"the starter should run cleanly and fail tests, not crash: {r['error']}"
    assert not r["passed"], "the starter already passes: the exercise asks for nothing"


# ---- the grader itself ----

def test_grader_reports_syntax_errors_with_the_line():
    r = harness.grade("def f(:\n  pass", "def test_x():\n    pass")
    assert not r["passed"] and r["error"].startswith("SyntaxError") and "line 1" in r["error"]


def test_grader_points_runtime_errors_at_your_line():
    r = harness.grade("def f():\n    return 1 / 0", "def test_x():\n    f()")
    assert r["tests"][0]["message"] == "ZeroDivisionError: division by zero (your code, line 2)"


def test_grader_runs_tests_in_order_with_docstring_names():
    tests = 'def test_b():\n    "second"\n    check("f()", f(), 2)\n\ndef test_a():\n    check("f()", f(), 1)'
    r = harness.grade("def f():\n    return 1", tests)
    assert [(t["name"], t["ok"]) for t in r["tests"]] == [("second", False), ("a", True)]
    assert r["tests"][0]["message"] == "f() returned 1, expected 2"


def test_grader_captures_print_output():
    r = harness.grade("print('hi')\ndef f():\n    print('in f')", "def test_x():\n    f()")
    assert r["passed"] and r["stdout"] == "hi\nin f\n"


def test_grader_forbid_and_only_calls():
    code = "def f(s):\n    return int(s, 2) + len(s)"
    r = harness.grade(code, 'def test_a():\n    forbid("int(s, base)")\n\ndef test_b():\n    only_calls("len")')
    assert [t["ok"] for t in r["tests"]] == [False, False]
    assert "int(s, base)" in r["tests"][0]["message"] and "calls int" in r["tests"][1]["message"]


def test_grader_ignores_test_functions_in_your_code():
    r = harness.grade("def test_cheat():\n    assert False", "def test_real():\n    pass")
    assert [t["name"] for t in r["tests"]] == ["real"]


def test_grader_raises_helper():
    r = harness.grade("def f(n):\n    return n", "def test_x():\n    raises(ValueError, f, 3)")
    assert r["tests"][0]["message"] == "f(3) should raise ValueError, but it returned normally"


def test_grade_json_reports_a_broken_lesson():
    r = json.loads(harness.grade_json("x = 1", "def test_a(:\n  pass"))
    assert not r["passed"] and r["error"].startswith("The lesson's own tests crashed")
