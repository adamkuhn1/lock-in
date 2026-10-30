PROGRAM = """
; Multiply X by Y into RESULT, using only the 8 instructions.
        LOAD ZERO
        STORE RESULT    ; result = 0
LOOP:   LOAD Y
        JZ DONE         ; while y != 0
        LOAD RESULT
        ADD X
        STORE RESULT    ;   result += x
        LOAD Y
        SUB ONE
        STORE Y         ;   y -= 1
        JMP LOOP
DONE:   HALT

X:      DATA 6
Y:      DATA 7
RESULT: DATA 0
ZERO:   DATA 0
ONE:    DATA 1
"""
