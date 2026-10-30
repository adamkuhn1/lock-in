import ast
import itertools


def _bits(n, width):
    return [(n >> i) & 1 for i in reversed(range(width))]


def test_mux():
    """mux picks a when sel is 0 and b when sel is 1"""
    for a, b, sel in itertools.product((0, 1), repeat=3):
        check(f"mux({a}, {b}, {sel})", mux(a, b, sel), b if sel else a)


def test_mux_is_gates_only():
    """mux is built from gates only"""
    fns = [n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == "mux"]
    assert fns, "Define a function named mux"
    for node in ast.walk(fns[0]):
        if isinstance(node, (ast.If, ast.IfExp, ast.BoolOp, ast.BinOp, ast.Compare, ast.UnaryOp, ast.Subscript)):
            raise AssertionError(f"mux, line {node.lineno}: use gates (and_, or_, not_), not Python operators or if")


def test_mux_bits():
    """mux_bits picks a whole number"""
    check("mux_bits([1, 0, 1, 0], [0, 1, 1, 0], 0)", mux_bits([1, 0, 1, 0], [0, 1, 1, 0], 0), [1, 0, 1, 0])
    check("mux_bits([1, 0, 1, 0], [0, 1, 1, 0], 1)", mux_bits([1, 0, 1, 0], [0, 1, 1, 0], 1), [0, 1, 1, 0])


def test_alu_arithmetic():
    """alu adds and subtracts, wrapping at the width"""
    for x, y in itertools.product(range(16), repeat=2):
        check(f"alu({_bits(x, 4)}, {_bits(y, 4)}, 'add')[0]", alu(_bits(x, 4), _bits(y, 4), "add")[0], _bits((x + y) % 16, 4))
        check(f"alu({_bits(x, 4)}, {_bits(y, 4)}, 'sub')[0]", alu(_bits(x, 4), _bits(y, 4), "sub")[0], _bits((x - y) % 16, 4))


def test_alu_logic():
    """alu does bitwise and, or and not"""
    x, y = [1, 1, 0, 0], [1, 0, 1, 0]
    check(f"alu({x}, {y}, 'and')[0]", alu(x, y, "and")[0], [1, 0, 0, 0])
    check(f"alu({x}, {y}, 'or')[0]", alu(x, y, "or")[0], [1, 1, 1, 0])
    check(f"alu({x}, {y}, 'not')[0]", alu(x, y, "not")[0], [0, 0, 1, 1])


def test_zero_flag():
    """The zero flag is 1 only when the result is all zeros"""
    check("alu([0, 1, 0, 1], [0, 1, 0, 1], 'sub')[1]", alu([0, 1, 0, 1], [0, 1, 0, 1], "sub")[1], 1)
    check("alu([1, 1, 1, 1], [0, 0, 0, 1], 'add')[1]  (wraps to 0)", alu([1, 1, 1, 1], [0, 0, 0, 1], "add")[1], 1)
    check("alu([0, 0, 1, 0], [0, 0, 0, 1], 'add')[1]", alu([0, 0, 1, 0], [0, 0, 0, 1], "add")[1], 0)
    check("alu([1, 0, 0, 0], [0, 1, 0, 0], 'and')[1]", alu([1, 0, 0, 0], [0, 1, 0, 0], "and")[1], 1)


def test_negative_flag():
    """The negative flag is the top bit of the result"""
    check("alu([0, 0, 1, 0], [0, 0, 1, 1], 'sub')[2]  (2 - 3)", alu([0, 0, 1, 0], [0, 0, 1, 1], "sub")[2], 1)
    check("alu([0, 0, 1, 1], [0, 0, 1, 0], 'sub')[2]  (3 - 2)", alu([0, 0, 1, 1], [0, 0, 1, 0], "sub")[2], 0)
    check("alu([0, 1, 1, 1], [0, 0, 0, 0], 'not')[2]", alu([0, 1, 1, 1], [0, 0, 0, 0], "not")[2], 1)
