def first_pass(text):
    """Pass 1: {label: address} for every label in the program."""
    labels = {}
    addr = 0
    for line in text.splitlines():
        label, name, _ = parse(line)
        if label:
            if label in labels:
                raise ValueError(f"label {label} is defined twice")
            labels[label] = addr
        if name:
            addr += 1
    return labels


def value(operand, labels):
    if operand is None:
        return 0
    try:
        return int(operand)
    except ValueError:
        pass
    if operand not in labels:
        raise ValueError(f"unknown label {operand}")
    return labels[operand]


def assemble(text):
    """Pass 2: a 32-word memory image. Raises ValueError on a bad program."""
    labels = first_pass(text)
    words = []
    for line in text.splitlines():
        _, name, operand = parse(line)
        if not name:
            continue
        v = value(operand, labels)
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
