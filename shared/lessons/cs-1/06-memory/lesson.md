Everything you've built so far is **combinational** logic: the output depends only on the inputs *right now*. Change the inputs, and the output changes as soon as the signal gets through the gates. An adder has no memory of the last sum.

A computer has to **remember**: the value it's working on, which instruction comes next, and the whole program and its data. That needs a different kind of circuit, called **sequential** logic, plus something to keep it in step: a **clock**.

## Remembering a bit

Wire two NAND gates so that each one's output feeds the other's input. That loop can sit stably in either of two states, and it stays there after the input that set it goes away. This is a **latch**, the simplest memory: feedback turned into storage. Build a slightly more careful version and you get a **flip-flop**, which stores one bit.

## The clock

If memory updated whenever its inputs changed, you'd get chaos. The adder's output flickers for a moment while the carries ripple through, and memory would capture the garbage.

So every memory element listens to a **clock**: a signal that ticks at a steady rate. A 3 GHz CPU ticks 3 billion times a second. Each tick splits time into two phases:

1. **Between ticks**, the combinational logic settles. Inputs flow through adders and muxes until every wire holds its final value.
2. **On the tick**, every memory element captures its input, all at the same instant. The new stored values become the outputs for the next cycle.

That's why clock speed has a ceiling. The slowest path through the logic, like a carry rippling across 64 bits, has to settle within one tick.

## A register

A **register** is a row of flip-flops plus a `load` input:

- `load = 1`: on the next tick, store the input value.
- `load = 0`: on the next tick, keep the old value.

Inside, that's the mux from lesson 5: `next = mux(current, input, load)`, fed into a flip-flop. Reading a register's `out()` always gives the value stored at the **last tick**, no matter what you've set its inputs to since. This one rule is the heart of sequential logic.

From here on, a stored word is a plain Python `int`. You've seen how the bits work, so now we can work a level up.

## RAM

**RAM** is many registers in a row, plus two pieces of circuitry:

- an **address decoder**, which delivers `load` only to the one register you're writing.
- a **mux tree**, which picks the addressed register's output when you read.

| address | 0 | 1 | 2 | 3 | … |
|---------|---|---|---|---|---|
| value   | 0 | 42 | 7 | 0 | … |

Reading is combinational: `read(2)` gives 7 right away. Writing is sequential: `set(1, 99, 1)` takes effect on the next `tick()`. Your laptop's 16 GB of DRAM stores bits as charge on capacitors rather than in flip-flops, but it has the same interface: an address in, a word out, and a write that lands on a clock edge.

## Your interface

```python
r = Register()
r.set(5, 1)    # input 5, load 1: nothing happens yet
r.out()        # 0  (the value from the last tick)
r.tick()
r.out()        # 5
```

The inputs stay as you last set them, like voltages on a wire. If `load` is still 1, the next tick just stores the same value again.

`RAM(size)` works the same way: `set(addr, value, load)`, then `tick()`, then `read(addr)`. Build RAM out of your `Register` class. A real chip does exactly that.
