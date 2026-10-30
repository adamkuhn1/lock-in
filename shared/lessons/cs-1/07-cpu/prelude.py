# Given: the instruction set. An instruction is one 8-bit word: opcode in the top 3 bits, address in the low 5.
MEM_SIZE = 32
OPCODES = {"HALT": 0, "LOAD": 1, "STORE": 2, "ADD": 3, "SUB": 4, "JMP": 5, "JZ": 6, "JN": 7}


def encode(name, addr=0):
    """encode("LOAD", 30) == 62"""
    return OPCODES[name] << 5 | addr
