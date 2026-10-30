# Given: nand, not_, and_, or_, xor_, half_adder, full_adder, add(a, b) -> (bits, carry), from_binary(bits)

def negate(bits):
    """-x in two's complement: flip every bit, then add 1. Same width as the input."""
    # your code here
    return bits


def to_signed(bits):
    """The two's complement value of bits, as a Python int."""
    # your code here
    return 0


def add_signed(a, b):
    """Returns (sum_bits, overflow): the carry is thrown away; overflow is True if the signed result is wrong."""
    # your code here
    return a, False
