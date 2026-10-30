def mux(a, b, sel):
    """a when sel is 0, b when sel is 1. Gates only."""
    return or_(and_(a, not_(sel)), and_(b, sel))


def mux_bits(a, b, sel):
    """mux, applied to every bit of two equal-length bit lists."""
    return [mux(x, y, sel) for x, y in zip(a, b)]


def alu(x, y, op):
    """op is "add", "sub", "and", "or" or "not" (not x). Returns (result_bits, zero, negative)."""
    results = {
        "add": add(x, y)[0],
        "sub": add(x, negate(y))[0],
        "and": [and_(a, b) for a, b in zip(x, y)],
        "or": [or_(a, b) for a, b in zip(x, y)],
        "not": [not_(a) for a in x],
    }
    result = results[op]
    zero = 1 if all(b == 0 for b in result) else 0
    return result, zero, result[0]
