def _pad(words):
    return list(words) + [0] * (MEM_SIZE - len(words))


COUNTDOWN = """
        LOAD COUNT
LOOP:   JZ END        ; LOOP is address 1
        SUB ONE
        STORE COUNT
        JMP LOOP
END:    HALT
COUNT:  DATA 5
ONE:    DATA 1
"""


def test_plain_instructions():
    """Assembles instructions with number operands"""
    check("assemble('LOAD 30 / ADD 31 / STORE 29 / HALT')",
          assemble("LOAD 30\nADD 31\nSTORE 29\nHALT"), _pad([62, 127, 93, 0]))


def test_comments_and_blank_lines():
    """Skips comments and blank lines"""
    text = "; adds two numbers\n\n   LOAD 30   ; first\n\nadd 31\nHALT\n"
    check("assemble(program with comments, blank lines, lowercase add)", assemble(text), _pad([62, 127, 0]))


def test_first_pass():
    """first_pass finds every label's address"""
    check("first_pass(COUNTDOWN)", first_pass(COUNTDOWN), {"LOOP": 1, "END": 5, "COUNT": 6, "ONE": 7})
    check("first_pass('START:\\nLOAD 1\\nEND: HALT')", first_pass("START:\nLOAD 1\nEND: HALT"), {"START": 0, "END": 1})


def test_forward_references():
    """Resolves labels used before they're defined"""
    check("assemble('JMP END / LOAD 1 / END: HALT')", assemble("JMP END\nLOAD 1\nEND: HALT"), _pad([5 << 5 | 2, 1 << 5 | 1, 0]))


def test_countdown_program():
    """Assembles the countdown program from the lesson"""
    check("assemble(COUNTDOWN)", assemble(COUNTDOWN), _pad([38, 197, 135, 70, 161, 0, 5, 1]))


def test_data():
    """DATA stores numbers, negatives in two's complement"""
    check("assemble('X: DATA 5 / Y: DATA -1 / DATA 200')", assemble("X: DATA 5\nY: DATA -1\nDATA 200"), _pad([5, 255, 200]))
    check("assemble('P: DATA Q / Q: DATA 7')  (DATA with a label)", assemble("P: DATA Q\nQ: DATA 7"), _pad([1, 7]))


def test_full_memory():
    """Returns exactly 32 words and allows a full program"""
    check("len(assemble('HALT'))", len(assemble("HALT")), 32)
    check("len(assemble(32 HALTs))", len(assemble("HALT\n" * 32)), 32)


def test_errors():
    """Raises ValueError on bad programs"""
    raises(ValueError, assemble, "FLY 3")
    raises(ValueError, assemble, "JMP NOWHERE")
    raises(ValueError, assemble, "LOAD 40")
    raises(ValueError, assemble, "LOAD -1")
    raises(ValueError, assemble, "HALT\n" * 33)
    raises(ValueError, first_pass, "A: HALT\nA: HALT")
