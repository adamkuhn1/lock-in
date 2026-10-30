# Given: MEM_SIZE = 32, OPCODES = {"HALT": 0, "LOAD": 1, ...}, encode(name, addr)

def run(memory, max_steps=1000):
    """Run the program in memory (32 ints) from address 0. Returns acc, pc, memory, halted and steps."""
    mem = list(memory)
    acc = pc = steps = 0
    halted = False
    # your code here: the fetch-decode-execute loop
    return {"acc": acc, "pc": pc, "memory": mem, "halted": halted, "steps": steps}
