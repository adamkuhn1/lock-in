MAX_STEPS = 1500


def _labels():
    assert isinstance(PROGRAM, str), "Set PROGRAM to a string of assembly"
    labels = first_pass(PROGRAM)
    missing = [n for n in ("X", "Y", "RESULT") if n not in labels]
    assert not missing, f"Your program needs these labels: {', '.join(missing)}"
    return labels


def _multiply(x, y, junk=0):
    labels = _labels()
    mem = assemble(PROGRAM)
    mem[labels["X"]], mem[labels["Y"]], mem[labels["RESULT"]] = x, y, junk
    out = run(mem, MAX_STEPS)
    assert out["halted"], (f"With X={x}, Y={y}, the program didn't HALT within {MAX_STEPS} steps. "
                           "Is there a loop that never exits?")
    return out["memory"][labels["RESULT"]]


def test_assembles():
    """PROGRAM assembles and defines X, Y and RESULT"""
    _labels()
    assemble(PROGRAM)


def test_six_times_seven():
    """6 × 7 = 42"""
    check("RESULT for X=6, Y=7", _multiply(6, 7), 42)


def test_small_products():
    """Small products, including 1 × 1"""
    for x, y in [(1, 1), (2, 3), (3, 2), (5, 5), (9, 4)]:
        check(f"RESULT for X={x}, Y={y}", _multiply(x, y), x * y)


def test_zero():
    """Anything times 0 is 0"""
    check("RESULT for X=9, Y=0", _multiply(9, 0), 0)
    check("RESULT for X=0, Y=9", _multiply(0, 9), 0)
    check("RESULT for X=0, Y=0", _multiply(0, 0), 0)


def test_big_products():
    """Products up to 255"""
    for x, y in [(15, 17), (12, 12), (2, 100), (100, 2), (255, 1)]:
        check(f"RESULT for X={x}, Y={y}", _multiply(x, y), x * y)


def test_resets_result():
    """Sets RESULT to 0 itself (doesn't trust its starting value)"""
    check("RESULT for X=6, Y=7 when RESULT starts at 99", _multiply(6, 7, junk=99), 42)
    check("RESULT for X=4, Y=0 when RESULT starts at 99", _multiply(4, 0, junk=99), 0)
