# Writing Lock In lessons

A lesson is a 10–20 minute read-and-do: a short explanation, quick checks inside the reading, and one Python
exercise graded instantly in the browser. Adam wants the most efficient learning possible, and he quits on material
he can't follow. Every rule below exists because an earlier draft broke it.

## Files

`shared/lessons/<module-id>/<NN-slug>/`, where `<module-id>` is a module in `shared/learning.json`:

| file | what |
|------|------|
| `lesson.md` | The reading. 400–700 words (CI caps it at 900). Markdown, tables and fenced `python` blocks. |
| `lesson.json` | `title` (≤ 60 chars), `minutes`, `task`, `hints`, `quiz`, `review`. |
| `starter.py` | Signatures, docstrings and placeholder returns. It must run cleanly and fail the tests, and never loop. |
| `solution.py` | The reference solution. Learners never see it unless they ask, after a warning. |
| `tests.py` | `test_*` functions in order. The docstring is the test name shown to the learner. |
| `prelude.py` | Optional. Code from earlier lessons, run before the learner's code. |

`harness.py` is the one grader, used by both the browser (Pyodide) and CI. Tests get these helpers:
`check(label, got, want)`, `raises(exc, fn, *args)`, `forbid(*names)`, `only_calls(*names)`, `calls` and `source`.
Failure messages must say what was called, what came back and what was expected.

## Questions

There are two shapes, and both work for `quiz` and `review`:

```json
{ "q": "...", "options": [{ "text": "...", "correct": true, "why": "..." }, ...] }
{ "q": "...", "answer": ["1010", "[1, 0, 1, 0]"], "why": "..." }
```

- **`quiz`** holds 1–5 quick checks, usually 2–3. Each one goes in `lesson.md` right after the section it tests,
  on its own line as `<!-- check N -->`, numbered in order. CI checks that every one is placed exactly once.
- **`review`** holds 3 spaced-review questions, shown days later. Make them mostly recall (`answer`), which builds
  memory better than recognizing the right option.
- **Recall answers.** The app ignores case, spaces, quotes and backticks, and compares numbers by value. List every
  reasonable format, and say the format in the question when it could be ambiguous ("Answer as a list", "Answer
  like `0101`").
- **Multiple choice.** Exactly one option is correct, and every option has a `why`. The app shuffles the options,
  but vary the correct one's position in the file too.

## Quality checklist

Before a lesson ships:

- [ ] **Questions test the idea with fresh numbers.** No quiz answer may be a sentence or example copied from the
      reading. If the text works 1111 + 0001, the check asks about 1110 + 0011.
- [ ] **The answer can't be guessed from the options' form.** The right option isn't the longest or most hedged.
      Wrong options are mistakes a learner would really make, and their `why` explains the mistake.
- [ ] **Every recall `answer` is computed, not typed from memory.** Run the solution to get it. A wrong accepted
      answer teaches the wrong thing, which makes it the worst bug a lesson can have.
- [ ] **Hints are tiered.**
      - Hint 1 points back to the idea in the lesson ("re-read the half adder table").
      - Hint 2 gives the structure in words.
      - Only the last hint is close to code.

      Never put the answer in hint 1.
- [ ] **The task states every edge case the tests check.** That covers negatives, errors, which function raises,
      wrap-around and state that persists. If a learner would only find a rule from a failing test, it belongs in
      the task or the reading.
- [ ] **Each rule is clear about which function it applies to**, for example "`negate` works on bits; `to_signed`
      can use normal Python".
- [ ] **The tests catch the plausible wrong solutions.** Run 2–3 of them (off-by-one, a missing edge case, a
      shortcut) through `harness.grade`. Each needs a failing test with a helpful message.
- [ ] **The spec and the tests agree both ways.** Anything the reading promises (like "pc wraps at 32") has a test.
- [ ] **`minutes` is honest for a first-timer:** reading, checks, the exercise and one debugging round. Dense
      lessons run 15–20.
- [ ] **No claim is false when simplified.** For example, "costs no extra time", not "costs nothing".
- [ ] **Debugging is supported.** When the output is hard to read, give a helper in the prelude, like lesson 9's
      `show()`, and say in the reading how to use it.

## The student test (required before a module ships)

CI proves that the solutions pass. It can't prove that the lessons teach. So before a module ships:

1. Give a fresh agent, with none of the authoring context, the module's folder and this brief:
   - Work every lesson in order as a student.
   - Read `lesson.md`, the task, the quiz and the starter.
   - Answer each quiz question before looking at the marked answer.
   - Write your own solution in a scratch folder and grade it with `harness.grade`.
   - Never open `solution.py` or `tests.py`.
   - Use hints only when stuck, and say whether each one helped.
2. It reports, for each lesson:
   - unclear or skipped steps
   - anything the exercise needed that the lesson didn't teach
   - spec gaps that only a failing test revealed
   - unhelpful failure messages and hints
   - guessable quiz questions
   - realistic minutes
3. Fix everything it reports, or write down why not. Then run
   `worker/.venv/bin/python -m pytest -q worker/tests/test_lessons.py`.
