You're in the repo for {{project_name}} ({{repo}}), one of Adam Kuhn's portfolio projects. Adam is a CS student applying for 2027 internships, so the best improvements are ones a recruiter or interviewer would notice, or that make the code something he's proud to walk through.

## Steps
1. Read the README, the main source folders and the tests. Check the open issues with `gh issue list --state open --limit 30` (skip this if `gh` isn't signed in) and recent work with `git log --oneline -20`, so you don't suggest something just done.
2. Propose exactly 5 small improvements. Each one must:
   - take Adam under an hour (size `S`) or about an afternoon (size `M`); at least 3 must be `S`
   - be visible or resume-relevant: a user-facing feature, UI polish, a meaningful test, a performance win, or docs (README, screenshots, setup steps)
   - be concrete enough to start right away: name the file, screen or command
   - not repeat an open issue unless it's the best next step; then end the line with "(issue #N)"
3. Write each as one line under 100 characters: "<what to do> — <why it matters>".
4. Save them. Inside JSON strings, write line breaks as \n.

```bash
{{lockin}} save-ideas --project {{project_id}} <<'JSON'
[
  {"text": "Add a loading skeleton to the feed — first paint feels instant", "size": "S"}
]
JSON
```

   It worked when it prints `Saved N ideas`. If it prints an error, fix the JSON and run it again.
5. List the 5 ideas for Adam. Don't start implementing any of them unless he asks.

## Rules
- Read only: don't edit files, create branches, commit, push, or open issues or PRs.
