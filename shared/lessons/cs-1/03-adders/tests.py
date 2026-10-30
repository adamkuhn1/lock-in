import ast
import itertools


def _bits(n, width):
    return [(n >> i) & 1 for i in reversed(range(width))]


def test_half_adder():
    """half_adder adds two bits"""
    for a, b in itertools.product((0, 1), repeat=2):
        check(f"half_adder({a}, {b})", tuple(half_adder(a, b)), ((a + b) % 2, (a + b) // 2))


def test_full_adder():
    """full_adder adds three bits"""
    for a, b, c in itertools.product((0, 1), repeat=3):
        check(f"full_adder({a}, {b}, {c})", tuple(full_adder(a, b, c)), ((a + b + c) % 2, (a + b + c) // 2))


def test_add_small():
    """add works on the example from the lesson"""
    check("add([0, 1, 1, 0], [0, 1, 1, 1])", tuple(add([0, 1, 1, 0], [0, 1, 1, 1])), ([1, 1, 0, 1], 0))
    check("add([0, 0, 1, 1], [0, 0, 0, 1])", tuple(add([0, 0, 1, 1], [0, 0, 0, 1])), ([0, 1, 0, 0], 0))


def test_add_carry_out():
    """add reports the carry that doesn't fit"""
    check("add([1, 1, 1, 1], [0, 0, 0, 1])", tuple(add([1, 1, 1, 1], [0, 0, 0, 1])), ([0, 0, 0, 0], 1))
    check("add([1, 0, 0, 0], [1, 0, 0, 0])", tuple(add([1, 0, 0, 0], [1, 0, 0, 0])), ([0, 0, 0, 0], 1))


def test_add_every_4_bit_pair():
    """add is right for every pair of 4-bit numbers"""
    for x, y in itertools.product(range(16), repeat=2):
        want = (_bits((x + y) % 16, 4), (x + y) // 16)
        check(f"add({_bits(x, 4)}, {_bits(y, 4)})", tuple(add(_bits(x, 4), _bits(y, 4))), want)


def test_add_8_bits():
    """add works at other widths"""
    check("add(<100 as 8 bits>, <55 as 8 bits>)", tuple(add(_bits(100, 8), _bits(55, 8))), (_bits(155, 8), 0))
    check("add([1], [1])", tuple(add([1], [1])), ([0], 1))


def test_gates_do_the_adding():
    """The gates do the adding (no + on the bits)"""
    forbid("sum", "int", "from_binary", "to_binary", "bin", "format")
    tree = ast.parse(source)
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name in ("half_adder", "full_adder")]:
        for node in ast.walk(fn):
            if isinstance(node, (ast.BinOp, ast.BoolOp, ast.Compare, ast.If, ast.IfExp)):
                raise AssertionError(f"{fn.name}, line {node.lineno}: use the gates, not Python operators")
