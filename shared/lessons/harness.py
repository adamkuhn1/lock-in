"""Lock In lesson grader. The same file runs in the browser (Pyodide, Grind → lessons) and in CI (worker/tests/
test_lessons.py), so what passes for Adam is exactly what CI checked.

grade(user_code, tests_code, prelude) runs the prelude (code the lesson gives you), then your code, then every
test_* function in tests.py, in the order they're written. A test fails by raising AssertionError; its message is
what Adam sees, so tests say what was called, what came back, and what was expected.

Helpers tests can use (they're in each test's globals):
  check(label, got, want)    fail with "label returned got, expected want" unless got == want
  raises(exc, fn, *args)     fail unless fn(*args) raises exc
  forbid(*names)             fail if your code calls any of these names (e.g. forbid("bin", "format")).
                             int called with a base counts as the name "int(s, base)".
  only_calls(*names)         fail if your code calls anything except these names
  calls                      the set of names your code calls
  source                     your code, as text
"""

from __future__ import annotations

import ast
import contextlib
import io
import traceback

USER_FILE = "your_code.py"
TESTS_FILE = "tests.py"
STDOUT_MAX = 4000


def _called_names(tree: ast.AST) -> set[str]:
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name):
                names.add(f.id)
                if f.id == "int" and (len(node.args) > 1 or any(k.arg == "base" for k in node.keywords)):
                    names.add("int(s, base)")
            elif isinstance(f, ast.Attribute):
                names.add(f.attr)
    return names


def _where(exc: BaseException) -> str:
    """The error as Adam should read it: type, message, and the line of his code it came from."""
    line = next((f.lineno for f in reversed(traceback.extract_tb(exc.__traceback__)) if f.filename == USER_FILE), None)
    text = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
    return f"{text} (your code, line {line})" if line else text


def grade(user_code: str, tests_code: str, prelude: str = "") -> dict:
    out = io.StringIO()
    result = {"passed": False, "tests": [], "stdout": "", "error": None}

    def finish():
        text = out.getvalue()
        result["stdout"] = text if len(text) <= STDOUT_MAX else text[:STDOUT_MAX] + "\n... (output cut off)"
        result["passed"] = result["error"] is None and bool(result["tests"]) and all(t["ok"] for t in result["tests"])
        return result

    ns: dict = {"__name__": "lesson"}
    if prelude:
        exec(compile(prelude, "given.py", "exec"), ns)
    try:
        tree = ast.parse(user_code, USER_FILE)
    except SyntaxError as e:
        result["error"] = f"SyntaxError: {e.msg} (your code, line {e.lineno})"
        return finish()
    try:
        with contextlib.redirect_stdout(out):
            exec(compile(tree, USER_FILE, "exec"), ns)
    except Exception as e:
        result["error"] = _where(e)
        return finish()

    calls = _called_names(tree)

    def check(label, got, want):
        if got != want:
            raise AssertionError(f"{label} returned {got!r}, expected {want!r}")

    def raises(exc, fn, *args):
        call = f"{fn.__name__}({', '.join(map(repr, args))})"
        try:
            fn(*args)
        except exc:
            return
        except Exception as e:
            raise AssertionError(f"{call} raised {type(e).__name__}, expected {exc.__name__}") from None
        raise AssertionError(f"{call} should raise {exc.__name__}, but it returned normally")

    def forbid(*names):
        used = sorted(calls & set(names))
        if used:
            raise AssertionError(f"Don't use {', '.join(used)} here: the point is to build it yourself")

    def only_calls(*names):
        other = sorted(calls - set(names))
        if other:
            raise AssertionError(f"Only {', '.join(names)} allowed, but your code calls {', '.join(other)}")

    tns = dict(ns, check=check, raises=raises, forbid=forbid, only_calls=only_calls, calls=calls, source=user_code)
    exec(compile(tests_code, TESTS_FILE, "exec"), tns)
    tests = [f for n, f in tns.items() if n.startswith("test_") and callable(f)
             and getattr(getattr(f, "__code__", None), "co_filename", "") == TESTS_FILE]
    for fn in tests:
        name = (fn.__doc__ or fn.__name__[5:].replace("_", " ")).strip()
        try:
            with contextlib.redirect_stdout(out):
                fn()
            result["tests"].append({"name": name, "ok": True, "message": ""})
        except AssertionError as e:
            result["tests"].append({"name": name, "ok": False, "message": str(e) or "Check failed"})
        except Exception as e:
            result["tests"].append({"name": name, "ok": False, "message": _where(e)})
    return finish()


def grade_json(user_code: str, tests_code: str, prelude: str = "") -> str:
    """grade() as JSON, for the browser (Pyodide hands back a string, no proxy objects to free)."""
    import json
    try:
        return json.dumps(grade(user_code, tests_code, prelude))
    except Exception as e:  # a broken tests.py or prelude: the lesson's bug, not Adam's
        return json.dumps({"passed": False, "tests": [], "stdout": "", "error": f"The lesson's own tests crashed: {_where(e)}"})
