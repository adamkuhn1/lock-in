# Given: the CPU (lesson 7) and the assembler (lesson 8). Write PROGRAM; you can call run(assemble(PROGRAM)) to try it.
MEM_SIZE = 32
OPCODES = {"HALT": 0, "LOAD": 1, "STORE": 2, "ADD": 3, "SUB": 4, "JMP": 5, "JZ": 6, "JN": 7}


def run(memory, max_steps=1000):
    mem = list(memory)
    acc = pc = steps = 0
    halted = False
    while steps < max_steps:
        word = mem[pc]
        pc = (pc + 1) % MEM_SIZE
        steps += 1
        op, addr = word >> 5, word & 0b11111
        if op == 0:
            halted = True
            break
        elif op == 1:
            acc = mem[addr]
        elif op == 2:
            mem[addr] = acc
        elif op == 3:
            acc = (acc + mem[addr]) % 256
        elif op == 4:
            acc = (acc - mem[addr]) % 256
        elif op == 5:
            pc = addr
        elif op == 6 and acc == 0:
            pc = addr
        elif op == 7 and acc >= 128:
            pc = addr
    return {"acc": acc, "pc": pc, "memory": mem, "halted": halted, "steps": steps}


def parse(line):
    line = line.split(";", 1)[0].strip()
    label = None
    if ":" in line:
        label, line = line.split(":", 1)
        label, line = label.strip(), line.strip()
    parts = line.split()
    if len(parts) > 2:
        raise ValueError(f"too many parts in {line!r}: expected NAME or NAME OPERAND")
    return label or None, (parts[0].upper() if parts else None), (parts[1] if len(parts) > 1 else None)


def first_pass(text):
    labels, addr = {}, 0
    for line in text.splitlines():
        label, name, _ = parse(line)
        if label:
            if label in labels:
                raise ValueError(f"label {label} is defined twice")
            labels[label] = addr
        if name:
            addr += 1
    return labels


def assemble(text):
    labels = first_pass(text)
    words = []
    for line in text.splitlines():
        _, name, operand = parse(line)
        if not name:
            continue
        if operand is None:
            v = 0
        elif operand.lstrip("-").isdigit():
            v = int(operand)
        elif operand in labels:
            v = labels[operand]
        else:
            raise ValueError(f"unknown label {operand}")
        if name == "DATA":
            words.append(v % 256)
            continue
        if name not in OPCODES:
            raise ValueError(f"unknown instruction {name}")
        if not 0 <= v < MEM_SIZE:
            raise ValueError(f"address {v} is outside 0..{MEM_SIZE - 1}")
        words.append(OPCODES[name] << 5 | v)
    if len(words) > MEM_SIZE:
        raise ValueError(f"program is {len(words)} words; memory holds {MEM_SIZE}")
    return words + [0] * (MEM_SIZE - len(words))


def show(text, x=None, y=None, max_steps=1500):
    """Debugging: run a program and print every label's final value. show(PROGRAM, 3, 2) sets X = 3 and Y = 2 first."""
    labels = first_pass(text)
    mem = assemble(text)
    if x is not None:
        mem[labels["X"]] = x % 256
    if y is not None:
        mem[labels["Y"]] = y % 256
    out = run(mem, max_steps)
    print(f"halted: {out['halted']} after {out['steps']} steps")
    for name, addr in labels.items():
        print(f"  {name} (address {addr}) = {out['memory'][addr]}")
    return out
