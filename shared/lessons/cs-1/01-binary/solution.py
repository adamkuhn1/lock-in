def to_binary(n, width):
    """n as a list of `width` bits, most significant first. Raise ValueError if it doesn't fit."""
    if not 0 <= n < 2 ** width:
        raise ValueError(f"{n} doesn't fit in {width} bits")
    bits = []
    for _ in range(width):
        bits.insert(0, n % 2)
        n //= 2
    return bits


def from_binary(bits):
    """A list of bits, most significant first, back to a number."""
    n = 0
    for b in bits:
        n = n * 2 + b
    return n
