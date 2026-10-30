You can now build any gate. This lesson turns gates into **arithmetic**: a circuit that adds two numbers. Every add your CPU does, billions per second, comes from the chain you're about to write.

## Adding by hand, in binary

Binary addition works like the column addition you learned in school, with only four cases:

| a | b | sum | carry |
|---|---|-----|-------|
| 0 | 0 | 0 | 0 |
| 0 | 1 | 1 | 0 |
| 1 | 0 | 1 | 0 |
| 1 | 1 | 0 | 1 |

1 + 1 = 2, which is `10` in binary: write 0, carry 1. Here is 6 + 7 worked column by column, right to left:

```
  carry   1 1 0
          0 1 1 0    (6)
        + 0 1 1 1    (7)
        ---------
          1 1 0 1    (13)
```

## Half adder: two gates

Look at the table again. The **sum** column is 1 when the inputs differ: that's **XOR**. The **carry** column is 1 only when both are 1: that's **AND**. So one XOR plus one AND add two bits. This circuit is called a **half adder**.

<!-- check 1 -->

## Full adder: three inputs

Every column except the rightmost also has to add the carry coming in from the column to its right. That's three bits in (`a`, `b`, `carry_in`) and two out. A **full adder** is two half adders:

1. Half-add `a` and `b`, giving a partial sum `s1` and a carry `c1`.
2. Half-add `s1` and `carry_in`, giving the final `sum` and a carry `c2`.
3. `carry_out` is `c1` OR `c2`.

A few of the 8 rows:

| a | b | c_in | sum | c_out |
|---|---|------|-----|-------|
| 1 | 1 | 0 | 0 | 1 |
| 1 | 0 | 1 | 0 | 1 |
| 1 | 1 | 1 | 1 | 1 |
| 0 | 0 | 1 | 1 | 0 |

<!-- check 2 -->

## Ripple-carry: chain them

To add two 8-bit numbers, line up 8 full adders, one per column. The rightmost column starts with carry 0. Each adder's carry-out feeds the next adder to its left. The carry "ripples" across, which is where the name **ripple-carry adder** comes from.

Remember, bits are most significant first, so the 1s column is the **last** item in the list. Walk from the end of the list to the front.

The carry out of the leftmost column is the extra bit that doesn't fit. Adding `1111` + `0001` gives `0000`, with carry 1. For unsigned numbers, that leftover carry means the result **overflowed**.

<!-- check 3 -->

## Why real chips don't stop here

The top bit can't be computed until the carry has rippled through every column below it. So a 64-bit ripple adder is 64 adders' worth of delay, and that would limit the clock speed. Real CPUs use **carry-lookahead** adders, which work out the carries in parallel. They still compute exactly the same function you're about to write.

## The rules for this exercise

The gates `nand`, `not_`, `and_`, `or_` and `xor_` are given. Build the adders from those gates, plus ordinary list and loop tools like `range`, `len` and `reversed`. Don't convert the bits back to a number and use `+`: the whole point is that the gates do the adding.
