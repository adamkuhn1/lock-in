You have an ALU that computes, registers that remember and RAM that stores. A **CPU** wires them together, so that a list of numbers in memory runs as a program.

## The big idea: programs are data

In the 1940s, "programming" a computer meant rewiring it by hand. The **stored-program** idea, written up by von Neumann in 1945, changed that: put the instructions in the *same memory* as the data, as plain numbers. To load a new program, you just write new numbers to memory. Every computer since works this way, and it's why a program can load another program, or write code at run time like a JIT compiler does.

## Our machine

This is a tiny machine, small enough to hold in your head:

- **Memory**: 32 words, each 8 bits (0–255), at addresses 0–31.
- **acc** (the accumulator): one register, where all the arithmetic happens.
- **pc** (the program counter): a register holding the address of the next instruction.

Each instruction is one 8-bit word. The top 3 bits are the **opcode** (what to do), and the low 5 bits are an **address**. 3 bits give 8 opcodes, and 5 bits reach all 32 addresses.

| opcode | name | what it does |
|--------|------|--------------|
| 0 | `HALT` | stop |
| 1 | `LOAD a` | acc = mem[a] |
| 2 | `STORE a` | mem[a] = acc |
| 3 | `ADD a` | acc = (acc + mem[a]) % 256 |
| 4 | `SUB a` | acc = (acc − mem[a]) % 256 |
| 5 | `JMP a` | pc = a |
| 6 | `JZ a` | if acc == 0: pc = a |
| 7 | `JN a` | if acc ≥ 128 (negative, in two's complement): pc = a |

`ADD` and `SUB` wrap at 256, just like your 8-bit ALU. `JZ` and `JN` read the zero and negative flags from lesson 5.

## Decoding

Splitting a word into its fields is just arithmetic on its bits:

```python
opcode = word >> 5      # the top 3 bits  (same as word // 32)
addr   = word & 0b11111 # the low 5 bits  (same as word % 32)
```

`LOAD 30` is opcode 1 and address 30: `001 11110` in binary, which is **62**.

We use Python ints from here on, not bit lists. You've built every part from gates, and now the interesting part is how they work together. This is how computer engineering works: prove a layer works, then build on top of it.

## The fetch-decode-execute cycle

Every CPU, including the one you're reading this on, runs this loop:

1. **Fetch**: `word = mem[pc]`, then move `pc` to the next address.
2. **Decode**: split `word` into an opcode and an address.
3. **Execute**: do what the opcode says. A jump overwrites `pc`.

Step 1 moves `pc` forward *before* the instruction runs, and that's what makes jumps simple: a jump just replaces `pc`. If `pc` steps past address 31, it wraps back to 0.

## A program, by hand

This program adds the numbers at addresses 30 and 31, and stores the sum at 29:

| addr | word | meaning |
|------|------|---------|
| 0 | 62  | `LOAD 30` |
| 1 | 127 | `ADD 31` |
| 2 | 93  | `STORE 29` |
| 3 | 0   | `HALT` |
| … | | |
| 30 | 20 | data |
| 31 | 22 | data |

It runs 4 steps, and leaves `acc` = 42, `mem[29]` = 42 and `pc` = 4.

## Your `run(memory, max_steps)`

- Work on a **copy** of `memory`. The caller's list must not change.
- Run until `HALT`, or until `max_steps` instructions have run. That second limit protects you from infinite loops.
- Return a dict with these keys:
  - `acc`
  - `pc`
  - `memory`: the final memory
  - `halted`: `True` if it stopped on `HALT`
  - `steps`: instructions executed, counting the `HALT`

`OPCODES` (for example, `OPCODES["LOAD"] == 1`) and `encode(name, addr)` are given, so you can build test programs. Use them in your code too, if you want readable names.
