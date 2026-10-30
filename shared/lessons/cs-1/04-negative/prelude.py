# Given: gates (lesson 2), adders (lesson 3) and from_binary (lesson 1).

def nand(a, b):
    return 0 if (a == 1 and b == 1) else 1


def not_(a):
    return nand(a, a)


def and_(a, b):
    return not_(nand(a, b))


def or_(a, b):
    return nand(not_(a), not_(b))


def xor_(a, b):
    n = nand(a, b)
    return nand(nand(a, n), nand(b, n))


def half_adder(a, b):
    return xor_(a, b), and_(a, b)


def full_adder(a, b, carry_in):
    s1, c1 = half_adder(a, b)
    s, c2 = half_adder(s1, carry_in)
    return s, or_(c1, c2)


def add(a, b):
    """Returns (sum_bits, carry_out)."""
    out = [0] * len(a)
    carry = 0
    for i in reversed(range(len(a))):
        out[i], carry = full_adder(a[i], b[i], carry)
    return out, carry


def from_binary(bits):
    n = 0
    for b in bits:
        n = n * 2 + b
    return n
