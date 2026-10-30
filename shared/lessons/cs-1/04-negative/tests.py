import itertools


def _bits(n, width):
    return [(n >> i) & 1 for i in reversed(range(width))]


def test_negate():
    """negate flips the sign"""
    check("negate([0, 0, 1, 1])", negate([0, 0, 1, 1]), [1, 1, 0, 1])
    check("negate([1, 1, 0, 1])", negate([1, 1, 0, 1]), [0, 0, 1, 1])
    check("negate([0, 0, 0, 1])", negate([0, 0, 0, 1]), [1, 1, 1, 1])


def test_negate_edges():
    """negate handles 0 and the most negative number"""
    check("negate([0, 0, 0, 0])", negate([0, 0, 0, 0]), [0, 0, 0, 0])
    check("negate([1, 0, 0, 0])", negate([1, 0, 0, 0]), [1, 0, 0, 0])
    check("negate(<5 as 8 bits>)", negate(_bits(5, 8)), _bits(251, 8))


def test_to_signed():
    """to_signed reads two's complement"""
    for bits, want in [([0, 1, 1, 1], 7), ([1, 0, 0, 0], -8), ([1, 1, 1, 1], -1), ([1, 1, 0, 1], -3), ([0, 0, 0, 0], 0)]:
        check(f"to_signed({bits})", to_signed(bits), want)
    check("to_signed(<128 as 8 bits>)", to_signed(_bits(128, 8)), -128)


def test_add_signed_values():
    """add_signed gets every 4-bit sum right (as bits)"""
    for x, y in itertools.product(range(16), repeat=2):
        s, _ = add_signed(_bits(x, 4), _bits(y, 4))
        check(f"add_signed({_bits(x, 4)}, {_bits(y, 4)})[0]", s, _bits((x + y) % 16, 4))


def test_overflow_cases():
    """add_signed flags overflow, and only overflow"""
    cases = [([0, 1, 1, 1], [0, 0, 0, 1], True),   # 7 + 1
             ([1, 0, 0, 0], [1, 1, 1, 1], True),   # -8 + -1
             ([1, 1, 1, 1], [1, 1, 1, 1], False),  # -1 + -1: carry out, but no overflow
             ([0, 0, 1, 1], [1, 1, 0, 1], False),  # 3 + -3: carry out, but no overflow
             ([0, 0, 1, 0], [0, 0, 1, 1], False)]  # 2 + 3
    for a, b, want in cases:
        check(f"add_signed({a}, {b})[1]", bool(add_signed(a, b)[1]), want)


def test_overflow_every_pair():
    """add_signed flags overflow exactly when the true sum doesn't fit in -8..7"""
    for x, y in itertools.product(range(-8, 8), repeat=2):
        a, b = _bits(x % 16, 4), _bits(y % 16, 4)
        check(f"add_signed({a}, {b})[1]  ({x} + {y})", bool(add_signed(a, b)[1]), not -8 <= x + y <= 7)


def test_built_from_bits():
    """Works on the bits (no converting to a number and back)"""
    forbid("to_binary", "bin", "format", "int(s, base)")
