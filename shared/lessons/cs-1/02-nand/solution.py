def not_(a):
    return nand(a, a)


def and_(a, b):
    return not_(nand(a, b))


def or_(a, b):
    return nand(not_(a), not_(b))


def xor_(a, b):
    n = nand(a, b)
    return nand(nand(a, n), nand(b, n))
