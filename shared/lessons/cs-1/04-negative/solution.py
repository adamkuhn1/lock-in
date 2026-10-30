def negate(bits):
    """-x in two's complement: flip every bit, then add 1. Same width as the input."""
    flipped = [not_(b) for b in bits]
    one = [0] * (len(bits) - 1) + [1]
    return add(flipped, one)[0]


def to_signed(bits):
    """The two's complement value of bits, as a Python int."""
    n = from_binary(bits)
    return n - 2 ** len(bits) if bits[0] == 1 else n


def add_signed(a, b):
    """Returns (sum_bits, overflow): the carry is thrown away; overflow is True if the signed result is wrong."""
    s, _ = add(a, b)
    return s, a[0] == b[0] and s[0] != a[0]
