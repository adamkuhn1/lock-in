def half_adder(a, b):
    """Add two bits. Returns (sum, carry)."""
    return xor_(a, b), and_(a, b)


def full_adder(a, b, carry_in):
    """Add three bits. Returns (sum, carry_out)."""
    s1, c1 = half_adder(a, b)
    s, c2 = half_adder(s1, carry_in)
    return s, or_(c1, c2)


def add(a, b):
    """Add two equal-length bit lists, most significant bit first. Returns (sum_bits, carry_out)."""
    out = [0] * len(a)
    carry = 0
    for i in reversed(range(len(a))):
        out[i], carry = full_adder(a[i], b[i], carry)
    return out, carry
