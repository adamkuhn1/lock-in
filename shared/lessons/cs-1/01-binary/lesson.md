Everything a computer does, from your browser to a neural network, comes down to wires that are either **on** or **off**. A transistor is a switch, and a switch has two states. So computers count with two digits, 0 and 1. Each one is a **bit**.

## Place value, in base 2

You already know place value from base 10. In `407`, each place is worth 10× the one to its right:

| place  | 100 | 10 | 1 |
|--------|-----|----|---|
| digit  | 4   | 0  | 7 |

4·100 + 0·10 + 7·1 = 407.

Base 2 works the same way, except each place is worth **2×** the one to its right:

| place  | 8 | 4 | 2 | 1 |
|--------|---|---|---|---|
| bit    | 1 | 1 | 0 | 1 |

1·8 + 1·4 + 0·2 + 1·1 = **13**. So `1101` in binary is 13.

## Going the other way

To turn 13 into bits, keep dividing by 2. The remainder is the next bit, **starting from the right**:

```
13 ÷ 2 = 6 remainder 1   ← rightmost bit
 6 ÷ 2 = 3 remainder 0
 3 ÷ 2 = 1 remainder 1
 1 ÷ 2 = 0 remainder 1   ← leftmost bit
```

Read the remainders bottom to top: `1101`. In Python, `n % 2` is the remainder and `n // 2` is the division.

## Hardware has a fixed width

A real circuit has a fixed number of wires. An 8-bit register always holds exactly 8 bits, so 13 is stored as `00001101`, padded with zeros on the left. With `w` bits, you can count from 0 up to 2ʷ − 1:

- 4 bits: 0 to 15
- 8 bits (a **byte**): 0 to 255
- 64 bits: 0 to about 18 quintillion

A number that doesn't fit simply can't be stored. Later in this module, that limit is what makes overflow happen.

## How bits look in this module

All the way up to the CPU you'll build in lesson 7, a group of bits is a Python list, **most significant bit first**, written the same way you'd write the number:

```python
[0, 0, 0, 0, 1, 1, 0, 1]   # 13 as 8 bits
```

So `bits[0]` is the biggest place, and `bits[-1]` is the 1s place.
