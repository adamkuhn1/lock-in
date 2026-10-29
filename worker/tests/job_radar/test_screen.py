import pytest

from job_radar import details, screen


@pytest.mark.parametrize("text", [
    "Candidates must be graduating between December 2025 and June 2026.",
    "Expected graduation date: Fall 2025 - Spring 2026",
    "Open to the Class of 2026 only.",
    "You are graduating in 2028.",
])
def test_wrong_grad_window(text):
    assert screen.grad_window(text) is not None


@pytest.mark.parametrize("text", [
    "Graduating between December 2026 and June 2027.",
    "Expected graduation: May 2027",
    "Graduating in 2026 or 2027",
    "Graduation date between Dec 2027 and Jun 2028.",
    "Recent graduates welcome. We were founded in 2012 and have grown fast.",
    "No dates here, just a graduate program.",
])
def test_grad_window_that_fits(text):
    assert screen.grad_window(text) is None


@pytest.mark.parametrize("text", [
    "Minimum qualifications\n3+ years of professional software engineering experience",
    "You have 2-4 years of experience building backend services.",
    "Requires two years of industry experience.",
    "What you'll need\n- 5+ years experience with Java",
])
def test_needs_years(text):
    assert screen.experience(text).startswith("Needs ")


@pytest.mark.parametrize("text", [
    "0-2 years of experience",
    "1+ years of experience (internships count)",
    "2+ years of experience, including internships or academic projects",
    "Preferred qualifications\n3+ years of experience with Kubernetes",
    "Nice to have: 2+ years of experience with Go",
    "We have 10 years of history.",  # no "experience"
    "A 4-year degree in Computer Science.",
])
def test_years_that_dont_rule_out(text):
    assert screen.experience(text) is None


@pytest.mark.parametrize("text", [
    "PhD required in machine learning or a related field.",
    "Currently pursuing a PhD in Computer Science.",
    "This role is for PhD students graduating in 2027.",
])
def test_needs_phd(text):
    assert screen.phd(text) == "Needs a PhD"


@pytest.mark.parametrize("text", [
    "Bachelor's, Master's or PhD in Computer Science.",
    "BS/MS in CS; PhD preferred.",
    "MS or PhD candidates are also welcome alongside undergrads.",
])
def test_phd_optional(text):
    assert screen.phd(text) is None


def test_screen_order_and_empty():
    assert screen.screen(None) is None
    assert screen.screen("Graduating between Jan 2025 and Jun 2026. PhD required.").startswith("For ")


def test_html_text_unescapes_greenhouse_content():
    raw = "&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;3+ years&lt;/li&gt;&lt;/ul&gt;"
    assert details.html_text(raw) == "Hello & welcome\n3+ years"
