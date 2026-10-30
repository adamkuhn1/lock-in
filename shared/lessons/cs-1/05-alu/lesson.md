You can add, subtract, AND and OR. A CPU has to do **one of those per instruction**, picked by the program. This lesson covers two things: the circuit that picks, called a **multiplexer**, and the unit that bundles all the operations together, the **ALU** (arithmetic logic unit).

## Choosing is also logic

A **multiplexer** ("mux") has two data inputs, `a` and `b`, and a select bit, `sel`. It passes `a` through when `sel` is 0, and `b` when `sel` is 1:

| sel | out |
|-----|-----|
| 0 | a |
| 1 | b |

There's no `if` in a circuit, only gates. Think of it as two AND gates acting as valves: one lets `a` through when `sel` is 0, the other lets `b` through when `sel` is 1. An OR combines them:

```
out = (a AND NOT sel) OR (b AND sel)
```

When `sel` is 0, the right side is forced to 0, so `out` is just `a`. When `sel` is 1, the left side is forced to 0, so `out` is `b`. To mux whole numbers, use one mux per bit, all sharing the same `sel` wire.

Muxes are everywhere in a CPU. They pick which register to read, which value gets written back, and whether the next instruction comes from `pc + 1` or from a jump target.

## The ALU: compute everything, then pick one

Here's the counterintuitive part. A hardware ALU doesn't "decide" which operation to run. Its adder, its AND gates and its OR gates are all wired to the inputs **all the time**, so every result is computed at once, in parallel. A tree of muxes, steered by the operation code, then lets exactly one result through. Computing results you'll throw away costs nothing extra, because gates run in parallel. What costs time is depth: how many gates a signal passes through.

Yours supports five operations on two equal-width bit lists:

| op | result |
|----|--------|
| `"add"` | x + y |
| `"sub"` | x − y, which is x + negate(y) |
| `"and"` | bitwise AND of each pair of bits |
| `"or"`  | bitwise OR |
| `"not"` | every bit of x flipped (y is ignored) |

In Python, choosing the result with a dict or an `if` is fine. It does the job of the mux tree, and it's easier to read.

## Flags: what the CPU wants to know

Along with the result, the ALU reports two **flags**, one bit each:

- **zero**: 1 if every bit of the result is 0.
- **negative**: the top bit of the result. In two's complement, that's the sign.

The flags are how a program makes decisions. A loop like "keep going until the counter hits 0" runs a subtract, then checks the zero flag. In lesson 7, your CPU's `JZ` (jump if zero) and `JN` (jump if negative) instructions use exactly these two flags. Real x86 and ARM chips keep them, plus carry and overflow flags, in a flags register.

The carry out of the adder is thrown away here, so results wrap around at the width, just like a fixed-width register.

## The rules for this exercise

The gates, `add` and `negate` are given. `mux` must be built from gates only: no `if` or operators. A test checks this. `mux_bits` and `alu` can use normal Python to loop and choose.
