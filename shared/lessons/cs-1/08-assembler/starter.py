# Given: MEM_SIZE = 32, OPCODES = {"HALT": 0, "LOAD": 1, ...}, parse(line) -> (label, name, operand)

def first_pass(text):
    """Pass 1: {label: address} for every label in the program."""
    labels = {}
    # your code here
    return labels


def assemble(text):
    """Pass 2: a 32-word memory image. Raises ValueError on a bad program."""
    labels = first_pass(text)
    words = []
    # your code here
    return words + [0] * (MEM_SIZE - len(words))
