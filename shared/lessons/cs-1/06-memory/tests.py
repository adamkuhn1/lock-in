def test_register_waits_for_the_tick():
    """A register's value changes only on tick()"""
    r = Register()
    check("Register().out()", r.out(), 0)
    r.set(5, 1)
    check("out() after set(5, 1), before tick()", r.out(), 0)
    r.tick()
    check("out() after set(5, 1) and tick()", r.out(), 5)


def test_register_load():
    """With load 0, a tick keeps the old value"""
    r = Register()
    r.set(5, 1)
    r.tick()
    r.set(9, 0)
    r.tick()
    check("out() after set(9, 0) and tick()", r.out(), 5)
    r.set(9, 1)
    r.tick()
    check("out() after set(9, 1) and tick()", r.out(), 9)


def test_register_inputs_stay_set():
    """Inputs stay as last set, like wires: the last set() before a tick wins"""
    r = Register()
    r.set(1, 1)
    r.set(2, 1)
    r.tick()
    check("out() after set(1, 1), set(2, 1), tick()", r.out(), 2)
    r.tick()
    check("out() after another tick()", r.out(), 2)


def test_ram_read_write():
    """RAM writes land on the tick, and reads are immediate"""
    m = RAM(8)
    check("RAM(8).read(3)", m.read(3), 0)
    m.set(3, 42, 1)
    check("read(3) after set(3, 42, 1), before tick()", m.read(3), 0)
    m.tick()
    check("read(3) after tick()", m.read(3), 42)


def test_ram_addresses_are_independent():
    """Writing one address leaves the others alone"""
    m = RAM(8)
    m.set(1, 10, 1)
    m.tick()
    m.set(2, 20, 1)
    m.tick()
    m.tick()
    check("read(1)", m.read(1), 10)
    check("read(2)", m.read(2), 20)
    check("read(0)", m.read(0), 0)
    m.set(1, 99, 0)
    m.tick()
    check("read(1) after set(1, 99, 0) and tick()", m.read(1), 10)


def test_ram_one_write_per_tick():
    """Only the last address set before a tick gets written"""
    m = RAM(8)
    m.set(1, 10, 1)
    m.set(2, 20, 1)
    m.tick()
    check("read(1) after set(1, 10, 1), set(2, 20, 1), tick()", m.read(1), 0)
    check("read(2) after set(1, 10, 1), set(2, 20, 1), tick()", m.read(2), 20)


def test_ram_bounds():
    """RAM rejects addresses outside 0..size-1"""
    m = RAM(4)
    raises(IndexError, m.read, 4)
    raises(IndexError, m.read, -1)
    raises(IndexError, m.set, 4, 1, 1)


def test_ram_is_made_of_registers():
    """RAM is built from your Register class"""
    assert "Register" in calls, "Build RAM out of Register objects: a list of them, one per address"
