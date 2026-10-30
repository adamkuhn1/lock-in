class Register:
    """One stored word. set() changes the inputs; the stored value changes only on tick(), and only if load is 1."""

    def __init__(self):
        self.value = 0
        # your code here: remember the inputs too

    def set(self, value, load):
        pass  # your code here

    def tick(self):
        pass  # your code here

    def out(self):
        return self.value


class RAM:
    """`size` registers in a row. read() is immediate; a write set() lands on the next tick()."""

    def __init__(self, size):
        self.size = size
        # your code here

    def set(self, addr, value, load):
        pass  # your code here

    def tick(self):
        pass  # your code here

    def read(self, addr):
        return 0  # your code here
