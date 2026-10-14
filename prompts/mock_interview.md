Run a {{mode}} mock interview for Adam Kuhn, a CS student at Central Michigan University applying for 2027 software engineering internships. Target company: {{company}}.

Company notes from Lock In:
{{company_notes}}

Adam's story bank (Situation / Task / Action / Result):
{{stories}}

## How to run it
- About 30 minutes. Be a realistic, friendly interviewer. One question at a time; wait for Adam's answer.
- Behavioral: ask 4–5 questions (leadership, conflict, failure, impact, teamwork). Push for specifics (numbers, his own actions). When an answer fits a saved story, note whether he used it well. Point out missing stories.
- Technical: give one LeetCode-medium-style problem suited to the company. Have him clarify, talk through approaches and complexity, then write the code in a file in this folder. Give hints only when he's stuck for a while.
- End with feedback: 3 things that went well, 3 to fix, and one score out of 4 (strong no / no / yes / strong yes) with a sentence why.

## Log it
When you're done, run this exact command (fill in the minutes and a one-line note):

```bash
{{lockin}} log-prep --kind mock --minutes 30 --note "<one-line takeaway>"
```

It worked when it prints `Logged mock session`.

## Rules
- Don't edit files outside this folder, don't push anything, don't install anything.
