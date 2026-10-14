import pytest
from lockin_worker import prompts


def test_render_fills_values_once():
    out = prompts.render("Hi {{name}}, id={{ id }}", {"name": "{{id}}", "id": "7"})
    assert out == "Hi {{id}}, id=7"  # a value that looks like a placeholder is not re-expanded


def test_render_missing_value_raises():
    with pytest.raises(prompts.TemplateError, match="missing values for: b"):
        prompts.render("{{a}} {{b}}", {"a": "1"})


def test_render_ignores_extra_values():
    assert prompts.render("{{a}}", {"a": "1", "z": "2"}) == "1"


def test_outreach_template_placeholders():
    t = prompts.load("outreach")
    assert prompts.placeholders(t) == {"outreach_id", "job_url", "company", "resume_path", "resume_note", "lockin"}


def test_outreach_template_has_guardrails_and_context():
    t = prompts.load("outreach")
    for needle in ["Never send", "Public information only", "Central Michigan University (CMU)",
                   "May 2027", "December 2027", "under 120 words", "`verified`", "`pattern`", "`guess`",
                   "{{lockin}} save-outreach --id {{outreach_id}} <<'JSON'", "Saved N contacts"]:
        assert needle in t, needle


def test_suggest_template():
    t = prompts.load("suggest_ideas")
    assert prompts.placeholders(t) == {"project_id", "project_name", "repo", "lockin"}
    assert "{{lockin}} save-ideas --project {{project_id}} <<'JSON'" in t
    assert "exactly 5" in t and "under an hour" in t


def test_prompts_dir_env_override(tmp_path, monkeypatch):
    (tmp_path / "x.md").write_text("{{a}}")
    monkeypatch.setenv("LOCKIN_PROMPTS_DIR", str(tmp_path))
    assert prompts.load("x") == "{{a}}"


def test_save_blocks_are_fenced_with_terminator_at_column_0():
    import re
    for name in ("outreach", "suggest_ideas"):
        t = prompts.load(name)
        assert re.search(r"(?m)^JSON$", t), name  # heredoc terminator at column 0
        assert "```bash" in t, name
        assert not re.search(r"(?m)^ +JSON$", t), name
        assert "write line breaks as \\n" in t, name
        assert not t.lstrip().startswith("-"), name
    assert "don't run save-outreach" in prompts.load("outreach")


def test_work_on_idea_template():
    t = prompts.load("work_on_idea")
    assert prompts.placeholders(t) == {"project_name", "repo", "idea_text", "idea_size", "readme", "branch"}
    assert "Don't push" in t and "blanket Bash permission" in t


def test_mock_interview_template():
    t = prompts.load("mock_interview")
    assert prompts.placeholders(t) == {"mode", "company", "company_notes", "stories", "lockin"}
    assert "{{lockin}} log-prep --kind mock" in t and "Logged mock session" in t


def test_work_on_idea_completion_copy_is_honest():
    t = prompts.load("work_on_idea")
    assert "reaches the project's main branch on GitHub" in t
    assert "ask him first; don't push yourself" in t and "He can also tick it done in the app." in t
    assert "the next commit on this project" not in t
    assert "~~~~\n{{readme}}\n~~~~" in t
