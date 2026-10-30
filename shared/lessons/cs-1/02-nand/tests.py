import ast

PAIRS = [(0, 0), (0, 1), (1, 0), (1, 1)]


def test_not():
    """not_ flips a bit"""
    check("not_(0)", not_(0), 1)
    check("not_(1)", not_(1), 0)


def test_and():
    """and_ matches the AND truth table"""
    for a, b in PAIRS:
        check(f"and_({a}, {b})", and_(a, b), 1 if (a, b) == (1, 1) else 0)


def test_or():
    """or_ matches the OR truth table"""
    for a, b in PAIRS:
        check(f"or_({a}, {b})", or_(a, b), 0 if (a, b) == (0, 0) else 1)


def test_xor():
    """xor_ matches the XOR truth table"""
    for a, b in PAIRS:
        check(f"xor_({a}, {b})", xor_(a, b), 1 if a != b else 0)


def test_only_nand():
    """Built only from nand and your own gates"""
    only_calls("nand", "not_", "and_", "or_", "xor_")
    banned = (ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Compare, ast.If, ast.IfExp)
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, banned):
            raise AssertionError(f"Line {node.lineno}: no operators, comparisons or if here. Wire gates together with calls only")
