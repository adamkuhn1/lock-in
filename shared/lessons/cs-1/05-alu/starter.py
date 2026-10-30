# Given: nand, not_, and_, or_, xor_, add(a, b) -> (bits, carry), negate(bits)

def mux(a, b, sel):
    """a when sel is 0, b when sel is 1. Gates only."""
    # your code here
    return 0


def mux_bits(a, b, sel):
    """mux, applied to every bit of two equal-length bit lists."""
    # your code here
    return a


def alu(x, y, op):
    """op is "add", "sub", "and", "or" or "not" (not x). Returns (result_bits, zero, negative)."""
    result = [0] * len(x)
    # your code here
    return result, 0, 0
