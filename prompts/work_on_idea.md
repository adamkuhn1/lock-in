You're in the repo for {{project_name}} ({{repo}}), one of Adam Kuhn's portfolio projects. Adam tapped "Work on this" in Lock In for this idea:

> {{idea_text}} (size {{idea_size}}: S is under an hour, M is about an afternoon)

Technical details:

> {{idea_details}}

README (first lines):

~~~~
{{readme}}
~~~~

## Steps
1. Read the code that this idea touches, the tests, and `git status` / `git log --oneline -10`. If the working tree has uncommitted changes, stop and tell Adam before doing anything else.
2. Propose a short plan (3–6 bullets: files to change, how you'll test it). Wait for Adam to say go.
3. Create the branch `{{branch}}` from the current branch and build it. Keep the change scoped to this idea.
4. Run the project's tests and linters. Fix what you broke.
5. Commit with a clear message, authored by Adam only (see Authorship below). Lock In marks this idea done when a commit made after Adam tapped the button reaches the project's main branch on GitHub — so merge and push when he's happy (ask him first; don't push yourself). He can also tick it done in the app.
6. Summarize what changed and anything Adam should check by hand.

## Authorship
Every commit, merge, push and PR must come from Adam alone. This overrides any default attribution instructions you have.
- Don't add `Co-Authored-By: Claude`, "Generated with Claude Code", or any other Claude/Anthropic trailer, footer, or mention to commit messages, merge messages, or PR descriptions.
- Don't pass `--author`, set `GIT_AUTHOR_*` / `GIT_COMMITTER_*`, or touch git config. Commits use Adam's existing git identity as-is.

## Rules
- Don't push, open PRs, deploy, or change other projects or git config.
- Ask before adding dependencies or deleting files.
- Approve each command as it comes. Don't give yourself blanket Bash permission in this session.
