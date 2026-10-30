class Register:
    """One stored word. set() changes the inputs; the stored value changes only on tick(), and only if load is 1."""

    def __init__(self):
        self.value = 0
        self.next_value = 0
        self.load = 0

    def set(self, value, load):
        self.next_value = value
        self.load = load

    def tick(self):
        if self.load:
            self.value = self.next_value

    def out(self):
        return self.value


class RAM:
    """`size` registers in a row. read() is immediate; a write set() lands on the next tick()."""

    def __init__(self, size):
        self.size = size
        self.regs = [Register() for _ in range(size)]

    def _check(self, addr):
        if not 0 <= addr < self.size:
            raise IndexError(f"address {addr} is outside 0..{self.size - 1}")

    def set(self, addr, value, load):
        self._check(addr)
        for r in self.regs:
            r.set(r.out(), 0)
        self.regs[addr].set(value, load)

    def tick(self):
        for r in self.regs:
            r.tick()

    def read(self, addr):
        self._check(addr)
        return self.regs[addr].out()
