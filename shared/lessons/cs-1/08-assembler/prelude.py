# Given: the instruction set from lesson 7, and a line parser.
MEM_SIZE = 32
OPCODES = {"HALT": 0, "LOAD": 1, "STORE": 2, "ADD": 3, "SUB": 4, "JMP": 5, "JZ": 6, "JN": 7}


def parse(line):
    """'LOOP:  JZ END ; note' -> ('LOOP', 'JZ', 'END'). Missing parts are None; the name is upper-cased."""
    line = line.split(";", 1)[0].strip()
    label = None
    if ":" in line:
        label, line = line.split(":", 1)
        label, line = label.strip(), line.strip()
    parts = line.split()
    if len(parts) > 2:
        raise ValueError(f"too many parts in {line!r}: expected NAME or NAME OPERAND")
    name = parts[0].upper() if parts else None
    operand = parts[1] if len(parts) > 1 else None
    return label or None, name, operand
