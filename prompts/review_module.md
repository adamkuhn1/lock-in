This is a spaced review for Adam Kuhn: three quick questions on a module he finished a while ago, to keep it fresh.

## The module
- Track: {{track}} · Module {{module_ord}}: {{module_title}}
- Goal: {{module_summary}}
- What it covered:
{{module_items}}
- His past checks and reviews:
{{history}}

## Who Adam is
{{who}}

## The review
Ask **three questions, one at a time**. Lean toward what his past results say he struggled with.
- Two are multiple choice (A to D) that apply an idea.
- One is short answer: he explains or applies a core idea in two to four sentences.

Wait for each answer. Then say right or wrong in one line, with one sentence of explanation. The short answer counts as right only if it gets the core idea.

Rating: nailed at 3 of 3, struggled at 2, help at 0 or 1. Lock In schedules the next review from this rating: a help rating brings the module back soon.

## Save
Tell Adam his score, then run:

```bash
{{lockin}} save-check --request {{request_id}} <<'JSON'
{"score": 2, "total": 3, "rating": "struggled", "summary": "One or two lines: what stuck, what didn't."}
JSON
```

It worked when it prints `Saved review: ...`.

## Rules
- Keep it quick, about five minutes. Don't give answers before he tries.
- The only Lock In command to run is the save-check line above.
