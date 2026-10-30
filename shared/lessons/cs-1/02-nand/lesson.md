A **logic gate** takes bits in and puts one bit out. It's a tiny circuit made of transistors, but you can think of it as a function: `gate(a, b) -> bit`.

There are many gates (AND, OR, NOT, XOR), and you might expect a chip to need a different circuit for each one. It doesn't. One gate is enough to build every other one, and therefore an entire computer: **NAND**.

## NAND: "not and"

NAND outputs 0 only when both inputs are 1. Otherwise it outputs 1:

| a | b | nand(a, b) |
|---|---|------------|
| 0 | 0 | 1 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

Why NAND? In CMOS, the transistor technology in almost every chip, a NAND gate takes just 4 transistors, and it's faster than AND. (An AND gate is literally a NAND followed by a NOT.) So real chip libraries lean on NAND, and the nand2tetris course builds a whole working computer starting from this one gate.

<!-- check 1 -->

## Building NOT

Feed the same bit into both inputs. `nand(0, 0)` is 1 and `nand(1, 1)` is 0, so:

```python
def not_(a):
    return nand(a, a)
```

That's the whole trick of this lesson: wire NANDs together, and use the gates you've already built to build the next ones.

## The gates you'll build

| a | b | and_ | or_ | xor_ |
|---|---|------|-----|------|
| 0 | 0 | 0 | 0 | 0 |
| 0 | 1 | 0 | 1 | 1 |
| 1 | 0 | 0 | 1 | 1 |
| 1 | 1 | 1 | 1 | 0 |

- **AND** is 1 when both inputs are 1. Look at the NAND table: it's exactly the opposite.
- **OR** is 1 when at least one input is 1. The key is **De Morgan's law**: "a or b" is the same as "not (not a and not b)". Read the right side as "it's not the case that both are off". Now notice that `nand(x, y)` already *is* "not (x and y)".
- **XOR** ("exclusive or") is 1 when the inputs **differ**. Put another way: at least one is on, **and** not both. It's the gate that matters most for arithmetic: in the next lesson, it's what adds two bits.

Why is NAND enough for *everything*? Any truth table at all can be written with AND, OR and NOT: OR together one AND term for each row that outputs 1. So once NAND gives you those three, it gives you every possible gate.

<!-- check 2 -->

## Gate count is real cost

Every gate is transistors on silicon, and every gate a signal passes through adds delay. So hardware designers count gates. Here are the best known NAND counts:

| gate | NANDs |
|------|-------|
| NOT  | 1 |
| AND  | 2 |
| OR   | 3 |
| XOR  | 4 |

You don't have to hit these counts. But if your XOR uses 10 NANDs, there's a neater way.

## The rules for this exercise

The `nand` function is given to you. Your gates may call `nand` and each other, and nothing else: no `and`, `or`, `not`, `if`, `==` or arithmetic. A test checks this. It sounds strict, but it's exactly the constraint a chip designer works under.
