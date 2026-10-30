Your adder handles 0 to 15 in 4 bits. Real programs also need negative numbers, and subtraction. You might expect that to need a second, subtracting circuit. It doesn't. With the right way of writing negatives, the adder you just built handles both, unchanged.

## The obvious idea, and why it fails

The obvious idea is to use the top bit as a sign: 0 for +, 1 for −. Then `0011` is 3 and `1011` is −3. This is called **sign-magnitude**, and it has two problems:

- It has **two zeros**: `0000` (+0) and `1000` (−0).
- Your adder gets it wrong: 3 + (−3) = `0011` + `1011` = `1110`, which reads as −6.

## Two's complement

The fix is to make the top bit's place worth a **negative** amount. In 4 bits, the places are −8, 4, 2, 1:

| bits | value | bits | value |
|------|-------|------|-------|
| `0000` | 0 | `1000` | −8 |
| `0001` | 1 | `1001` | −7 |
| `0011` | 3 | `1101` | −3 |
| `0111` | 7 | `1111` | −1 |

`1101` = −8 + 4 + 1 = **−3**. There's one zero, and the range is −8 to 7. In general, `w` bits cover −2ʷ⁻¹ to 2ʷ⁻¹ − 1. A 32-bit `int` in C or Java covers about ±2.1 billion this way.

A quick way to read it: take the plain unsigned value, and if the top bit is 1, subtract 2ʷ. `1101` is 13 unsigned, and 13 − 16 = −3.

## Negating: flip, then add 1

To get −x, flip every bit and add 1:

```
 3 = 0011
flip 1100
 +1  1101   = −3
```

Why does this work? x + (flip x) is always `1111`, which is −1. So flip x = −1 − x, and flip x + 1 = −x.

One odd case: −8 = `1000` flips to `0111`, and adding 1 gives `1000` again. −8 has no positive partner in 4 bits, because +8 doesn't fit.

## The same adder works

Now 3 + (−3):

```
  0011
+ 1101
 -----
 10000
```

That's 5 bits. Throw away the carry out and you get `0000`, which is correct. So **subtraction is just addition**: a − b = a + negate(b), and one adder circuit does both. That's why every CPU uses two's complement.

## Overflow is different for signed numbers

For unsigned numbers, carry out means overflow. For signed numbers, it doesn't. −1 + −1 = `1111` + `1111` = `1 1110`: the carry is 1, but `1110` is −2, which is correct.

Signed overflow happens when two numbers **with the same sign** produce a result with **the other sign**:

- 7 + 1 = `0111` + `0001` = `1000`, which reads as −8. Two positives can't sum to a negative: **overflow**.
- −8 + −1 = `1000` + `1111` = `0111`, which reads as 7. That's **overflow** too.

Adding a positive to a negative can never overflow, because the result always lands between the two.

This is a real source of bugs. In C, overflowing a signed int is undefined behavior. Java's own `Arrays.binarySearch` shipped for about nine years with `(low + high) / 2`, which overflows on huge arrays and produces a negative index.

## The rules for this exercise

The gates, `half_adder`, `full_adder`, `add(a, b)` and `from_binary(bits)` are given. Build everything from them. Don't convert to a number and back.
