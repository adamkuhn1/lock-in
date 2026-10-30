def _mem(program, data=None):
    m = list(program) + [0] * (MEM_SIZE - len(program))
    for addr, value in (data or {}).items():
        m[addr] = value
    return m


ADD_PROGRAM = [encode("LOAD", 30), encode("ADD", 31), encode("STORE", 29), encode("HALT")]


def test_add_program():
    """Runs the add program from the lesson"""
    out = run(_mem(ADD_PROGRAM, {30: 20, 31: 22}))
    check("run(add program)['memory'][29]", out["memory"][29], 42)
    check("run(add program)['acc']", out["acc"], 42)
    check("run(add program)['halted']", out["halted"], True)
    check("run(add program)['steps']", out["steps"], 4)
    check("run(add program)['pc']", out["pc"], 4)


def test_leaves_input_alone():
    """Works on a copy: the memory you pass in doesn't change"""
    mem = _mem(ADD_PROGRAM, {30: 20, 31: 22})
    before = list(mem)
    run(mem)
    check("the memory list passed to run() afterwards", mem == before, True)


def test_wraps_at_256():
    """ADD and SUB wrap around like an 8-bit register"""
    sub = [encode("LOAD", 30), encode("SUB", 31), encode("HALT")]
    check("acc after 3 - 5", run(_mem(sub, {30: 3, 31: 5}))["acc"], 254)
    add = [encode("LOAD", 30), encode("ADD", 31), encode("HALT")]
    check("acc after 200 + 100", run(_mem(add, {30: 200, 31: 100}))["acc"], 44)


def test_jmp():
    """JMP sets the next instruction"""
    prog = [encode("LOAD", 30), encode("JMP", 3), encode("STORE", 29), encode("HALT")]
    out = run(_mem(prog, {30: 7}))
    check("mem[29] (the STORE should be jumped over)", out["memory"][29], 0)
    check("steps", out["steps"], 3)


def test_jz():
    """JZ jumps only when acc is 0"""
    prog = [encode("LOAD", 30), encode("JZ", 4), encode("LOAD", 31), encode("STORE", 29), encode("HALT")]
    check("mem[29] when mem[30] is 0 (JZ taken)", run(_mem(prog, {30: 0, 31: 9}))["memory"][29], 0)
    check("mem[29] when mem[30] is 5 (JZ not taken)", run(_mem(prog, {30: 5, 31: 9}))["memory"][29], 9)


def test_jn():
    """JN jumps only when acc is negative (128 or more)"""
    prog = [encode("LOAD", 30), encode("SUB", 31), encode("JN", 5), encode("LOAD", 31), encode("STORE", 29), encode("HALT")]
    check("mem[29] for 2 - 3 (negative: JN taken)", run(_mem(prog, {30: 2, 31: 3}))["memory"][29], 0)
    check("mem[29] for 5 - 3 (positive: JN not taken)", run(_mem(prog, {30: 5, 31: 3}))["memory"][29], 3)
    check("mem[29] for 0 - 128 (acc is exactly 128, which is negative: JN taken)", run(_mem(prog, {30: 0, 31: 128}))["memory"][29], 0)


def test_countdown_loop():
    """Runs a loop: count mem[30] down to 0"""
    prog = [encode("LOAD", 30), encode("JZ", 5), encode("SUB", 31), encode("STORE", 30), encode("JMP", 1), encode("HALT")]
    out = run(_mem(prog, {30: 5, 31: 1}))
    check("mem[30] after counting down from 5", out["memory"][30], 0)
    check("halted", out["halted"], True)
    check("steps", out["steps"], 1 + 5 * 4 + 2)


def test_max_steps():
    """Stops after max_steps on a program that never halts"""
    out = run(_mem([encode("JMP", 0)]), max_steps=50)
    check("run(infinite loop, max_steps=50)['halted']", out["halted"], False)
    check("run(infinite loop, max_steps=50)['steps']", out["steps"], 50)


def test_instructions_are_data():
    """A program can overwrite its own instructions (they're just numbers in memory)"""
    # mem[31] is 0, which is HALT. Store it over the JMP at address 2, so the program stops there.
    prog = [encode("LOAD", 31), encode("STORE", 2), encode("JMP", 0)]
    out = run(_mem(prog), max_steps=100)
    check("halted (the JMP at 2 was overwritten with HALT)", out["halted"], True)
    check("steps", out["steps"], 3)


def test_pc_wraps():
    """pc wraps from address 31 back to 0"""
    # 0: JZ 31 (acc is 0, so jump), 31: ADD 30 (acc = 5, pc wraps to 0), 0: JZ 31 (acc is 5: no jump), 1: HALT
    mem = _mem([encode("JZ", 31), encode("HALT")], {30: 5, 31: encode("ADD", 30)})
    out = run(mem, max_steps=20)
    check("acc after running the instruction at address 31 and wrapping", out["acc"], 5)
    check("halted", out["halted"], True)
    check("steps", out["steps"], 4)
