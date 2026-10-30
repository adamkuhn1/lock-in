You've built the whole stack: gates, adders, signed numbers, the ALU, memory, a CPU and an assembler. Now use it like the engineers of the 1950s did: write a real program for a machine that can barely do anything.

The machine has **no multiply instruction**. Your job is to multiply anyway.

## The instruction set, one more time

| name | does |
|------|------|
| `LOAD a` | acc = mem[a] |
| `STORE a` | mem[a] = acc |
| `ADD a` / `SUB a` | acc = acc ± mem[a], wrapping at 256 |
| `JMP a` | jump to a |
| `JZ a` | jump to a if acc == 0 |
| `JN a` | jump to a if acc ≥ 128 |
| `HALT` | stop |
| `DATA n` | a word holding n (not an instruction) |

Every operand is an **address**, never a plain number. There's no "add 1". To add 1, you need a word that holds 1, like `ONE: DATA 1`, and then you write `ADD ONE`.

## Multiplying with addition

6 × 7 is 6 added up 7 times. As a loop:

```python
result = 0
while y != 0:
    result = result + x
    y = y - 1
```

Notice that the check comes **before** the body. If `y` starts at 0, the loop never runs, and the result stays 0.

## Translating a loop to assembly

There's no `while` in assembly. A loop is a label, a test that jumps out, and a jump back to the top:

```
LOOP:   LOAD Y
        JZ DONE        ; y == 0? we're finished
        ...            ; the body
        JMP LOOP
DONE:   HALT
```

The body has a constraint: the accumulator is your only working space. To change `RESULT`, you have to `LOAD` it, `ADD` to it and `STORE` it back. The same goes for counting `Y` down.

Put your data words **after** the `HALT`. The CPU never runs them as instructions, because it stops first.

## Don't trust starting memory

Real programs can't assume memory starts out zeroed. Here, the tests may leave junk in `RESULT` before running your program. So your program has to set `RESULT` to 0 itself, before the loop starts. To do that, keep a `ZERO: DATA 0` word to load from.

## Tracing it

Here is a trace for x = 3, y = 2. The values are at the moment each check of `Y` runs:

| check of Y | Y | RESULT | jump to DONE? |
|------------|---|--------|---------------|
| 1st | 2 | 0 | no |
| 2nd | 1 | 3 | no |
| 3rd | 0 | 6 | yes |

When your program fails, trace it like this on paper. That's what debugging looked like before debuggers existed, and it's still the fastest way to understand a loop.

## How the tests run it

The tests use the given `assemble` and `run` from lessons 7 and 8. For each test case, they:

1. assemble your `PROGRAM`
2. write test values into the words labeled `X` and `Y`, and put junk in `RESULT`
3. run it for up to 1500 steps
4. check that it halted and that `RESULT` holds x × y

So your program must define the labels `X`, `Y` and `RESULT`. Every product in the tests fits in 8 bits. To see what your program does, you can `print(run(assemble(PROGRAM)))` in your code. The output shows up below the test results.

## Why real CPUs have a MUL instruction

Your loop takes 9 steps for every unit of `y`, so 2 × 100 takes about 900 steps. Real hardware multiplies with **shift-and-add**: one step per *bit* of `y`, so 8 steps for any 8-bit number, and 64 for a 64-bit one, all done in dedicated circuits.

That's the pattern of this whole module. Whatever software keeps doing slowly, hardware eventually builds in.
