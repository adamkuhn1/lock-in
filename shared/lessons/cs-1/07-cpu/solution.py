def run(memory, max_steps=1000):
    """Run the program in memory (32 ints) from address 0. Returns acc, pc, memory, halted and steps."""
    mem = list(memory)
    acc = pc = steps = 0
    halted = False
    while steps < max_steps:
        word = mem[pc]                      # fetch
        pc = (pc + 1) % MEM_SIZE
        steps += 1
        op, addr = word >> 5, word & 0b11111  # decode
        if op == OPCODES["HALT"]:           # execute
            halted = True
            break
        elif op == OPCODES["LOAD"]:
            acc = mem[addr]
        elif op == OPCODES["STORE"]:
            mem[addr] = acc
        elif op == OPCODES["ADD"]:
            acc = (acc + mem[addr]) % 256
        elif op == OPCODES["SUB"]:
            acc = (acc - mem[addr]) % 256
        elif op == OPCODES["JMP"]:
            pc = addr
        elif op == OPCODES["JZ"] and acc == 0:
            pc = addr
        elif op == OPCODES["JN"] and acc >= 128:
            pc = addr
    return {"acc": acc, "pc": pc, "memory": mem, "halted": halted, "steps": steps}
