Writing programs as numbers like 62, 127 and 93 is miserable. One wrong digit, and you've jumped into your data. So the first program anyone writes for a new machine is an **assembler**: it turns readable text into machine code.

## Assembly is a thin layer

Assembly language maps **one line to one word**. There's no magic in it, only names:

```
        LOAD 30      ; acc = mem[30]
        ADD 31
        STORE 29
        HALT
```

`LOAD 30` becomes `OPCODES["LOAD"] << 5 | 30` = 62, which is exactly what you computed by hand in lesson 7. Everything after `;` is a comment.

## Labels: let the assembler count

Hard-coded addresses break as soon as you insert a line. **Labels** name an address instead:

```
        LOAD COUNT
LOOP:   JZ END        ; LOOP is address 1
        SUB ONE
        STORE COUNT
        JMP LOOP
END:    HALT          ; END is address 5
COUNT:  DATA 5        ; a word of data, not an instruction
ONE:    DATA 1
```

- `NAME:` at the start of a line gives the name to the address of that line's word. A label alone on its line names the address of the **next** word.
- `DATA n` puts the number `n` straight into memory. Negative numbers are stored in two's complement: `DATA -1` becomes 255, which is `n % 256`.
- An operand can be a number or a label. `HALT` needs no operand, which means address 0.

## Why two passes

Look at `JZ END` on line 2. When the assembler reaches it, it hasn't seen `END` yet. That's a **forward reference**, and you can't encode the word without END's address.

The classic fix is to read the program **twice**:

1. **First pass**: just count. Walk the lines with an address counter that starts at 0. When a line has a label, record `labels[name] = address`. When it has an instruction or `DATA`, add 1 to the address. Don't encode anything yet.
2. **Second pass**: walk the lines again. Every label is now known, so each instruction or `DATA` line can become a word.

For the program above, the first pass gives:

| label | address |
|-------|---------|
| LOOP  | 1 |
| END   | 5 |
| COUNT | 6 |
| ONE   | 7 |

The second pass gives `[38, 197, 135, 70, 161, 0, 5, 1]`: `LOAD COUNT` is 1·32 + 6 = 38, `JZ END` is 6·32 + 5 = 197, and so on. Real assemblers and linkers do the same thing at a larger scale. A linker's main job is resolving names to addresses, across many files.

## Errors are part of the job

An assembler that quietly produces garbage is worse than none. Raise `ValueError` with a clear message when:

- an instruction name isn't in `OPCODES` (and isn't `DATA`)
- a label is used but never defined, or is defined twice
- an address operand is outside 0–31
- the program needs more than 32 words

## What's given

`parse(line)` handles the boring text work. It strips the comment and splits the line into `(label, name, operand)`, with `None` for any missing part, and it upper-cases the name:

```python
parse("LOOP:   JZ END   ; check")  # ('LOOP', 'JZ', 'END')
parse("END:")                      # ('END', None, None)
parse("   ; just a comment")       # (None, None, None)
```

`OPCODES` and `MEM_SIZE` are given too. You write the two passes. `assemble` returns a full memory image: exactly 32 words, padded with zeros, ready for lesson 7's `run`.
