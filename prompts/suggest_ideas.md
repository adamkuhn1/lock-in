You're in the repo for {{project_name}} ({{repo}}), one of Adam Kuhn's portfolio projects. Adam is a CS student applying for 2027 internships, so the best improvements are ones a recruiter or interviewer would notice, or that make the code something he's proud to walk through.

## Steps
1. Read the README, the main source folders and the tests. Check the open issues with `gh issue list --state open --limit 30` (skip this if `gh` isn't signed in) and recent work with `git log --oneline -20`, so you don't suggest something just done.
2. Propose exactly 5 small improvements. Each one must:
   - take Adam under an hour (size `S`) or about an afternoon (size `M`); at least 3 must be `S`
   - be visible or resume-relevant: a user-facing feature, UI polish, a meaningful test, a performance win, or docs (README, screenshots, setup steps)
   - be concrete enough to start right away: name the file, screen or command
   - not repeat an open issue unless it's the best next step; then end the line with "(issue #N)"
3. Write each idea twice:
   - `text`: what Adam sees in the app. One short line (under 80 characters) in simple, everyday English that someone who doesn't code could follow: what changes for the user or the project, not how. No file names, function names, libraries or jargon (no "Web Worker", "a11y", "drawAim", "CI"). Example: "Show where the cue ball will land so aiming is easier".
   - `details`: the technical brief Claude Code gets when Adam taps "Work on this". 1–3 sentences naming the files, functions, commands and approach, plus why it matters. Example: "Draw a ghost ball in drawAim (src/render.ts) where the aim line first meets a ball — aiming feels like real pool."
4. Save them. Inside JSON strings, write line breaks as \n.

```bash
{{lockin}} save-ideas --project {{project_id}} <<'JSON'
[
  {"text": "Show placeholder shapes while the feed loads so it feels instant", "details": "Add a loading skeleton to Feed.tsx shown while useFeed() is pending — first paint feels instant.", "size": "S"}
]
JSON
```

   It worked when it prints `Saved N ideas`. If it prints an error, fix the JSON and run it again.
5. List the 5 ideas for Adam (the plain `text`, with the `details` under each). Don't start implementing any of them unless he asks.

## Rules
- Read only: don't edit files, create branches, commit, push, or open issues or PRs.
