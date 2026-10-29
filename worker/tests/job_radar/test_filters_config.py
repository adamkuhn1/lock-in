from pathlib import Path

import pytest

from job_radar.config import ConfigError, load_companies, load_filters, load_lists

ROOT = Path(__file__).parent.parent
FILTERS = load_filters(ROOT / "config/filters.yaml")


@pytest.mark.parametrize("title", [
    "Software Engineer, New Grad",
    "New Graduate Software Engineer (2027)",
    "Early Career Software Engineer",
    "University Grad - Backend Engineer",
    "Entry-Level Developer",
    "Software Engineer I",
    "Software Engineer 1 - Backend",
    "Co-op, Software Engineering",
    "Winter Internship - ML",
    "Spring 2027 Data Science Intern",
    "Software Engineer, Intern (Summer or Winter)",   # offers winter
    "Software Developer Intern/Co-op, Backend (Winter 2027)",
    "Software Engineer Co-op",
    "Middleware Software Intern (Winter 2027)",       # Simplify row + Terms column
    "UI Intern (Summer 2027, Winter 2027)",
    "Junior Software Developer",
    "Jr. Backend Engineer",
    "Associate Software Engineer",
    "Associate Application Developer - Azure",
    "Software Development Engineer I",
    "Data Engineer 1",
    "Graduate Software Engineer",
    "Software Engineer - New College Grad",
    "Technology Rotational Program - Software",
    "Software Engineering Apprenticeship",
])
def test_include(title):
    assert FILTERS.matches(title)


@pytest.mark.parametrize("title", [
    "Senior Software Engineer",
    "Staff Engineer, New Grad Programs",          # exclude wins over include
    "Principal Engineer",
    "Engineering Manager, Early Career",
    "PhD Intern, Research",
    "Ph.D. Research Intern",
    "Sr. Software Engineer",
    "Sr Software Engineer I",
    "Software Engineer II",                       # not "I"
    "Software Engineer, Infrastructure",          # not "I"
    "Internal Tools Engineer",                    # not "intern"
    "Financial Partnerships Lead, International", # not "intern"
    "Software Engineer",                          # no early-career signal
    # no Summer 2027 internships
    "Software Engineer Intern - Summer 2027",
    "Software Engineering Intern, Backend (Summer 2027)",
    "Summer 2027 Co-op",
    "Software Engineer, Intern",                  # untermed intern → assume summer
    "Software Engineer Intern (2027)",
    "Internship, Platform",
    "Engineering Intern (Fall 2026)",
    "Data Engineer Intern (Summer 2027)",
    "Software Development Engineer II",           # not "I"
    "Associate Director, Engineering",
    "Associate Principal Software Engineer",
    "Associate Product Marketing Lead",           # no engineer/developer
    "Entry Level Hardware Developer 2027 - Austin",
    "Entry level Compliance EMC HW Developer - 2027",
    "Technical Support - Hardware and Software Products - 2027",
])

def test_exclude_or_no_match(title):
    assert not FILTERS.matches(title)


@pytest.mark.parametrize("title", [
    "Machine Learning Research Perception Intern 🎓 Spring 2027",
    "Software Engineer Intern - Master's (Spring 2027)",
    "Software Engineer Intern - Master’s (Spring 2027)",
    "MS/PhD Research Intern, Winter 2027",
    "M.S./Ph.D. Research Intern, Winter 2027",
    "Graduate Student Researcher - Spring 2027",
    "Postdoctoral Fellow",
    "Post-doc Researcher, Spring 2027",
    "Doctoral Intern (Spring 2027)",
    "Software Intern, Masters Program (Spring 2027)",
    "Master of Science Intern - Winter 2027",
    "Master of Engineering Intern - Winter 2027",
    "Doctorate Research Intern",
    "Postgraduate Intern Spring 2027",
    "Post-graduate Intern Spring 2027",
])
def test_advanced_degree_excluded(title):
    assert not FILTERS.matches(title)
    assert not FILTERS.matches(title, check_include=False)


@pytest.mark.parametrize("title", [
    "Software Engineer Intern (Spring 2027)",
    "Master Data Engineer - New Grad 2027",
    "University Graduate Software Engineer 2027",
    "Scrum Master Intern (Spring 2027)",
    "Software Engineer Intern (Bachelor's or Master's) Spring 2027",
    "Software Engineer Intern (Bachelor’s or Masters degree) Spring 2027",
])
def test_advanced_degree_not_overmatched(title):
    assert FILTERS.matches(title)


def test_hardware_rule_keeps_software_titles():
    assert FILTERS.matches("Hardware/Software Co-design Engineer, New Grad 2027")
    assert FILTERS.matches("Software Engineer, Hardware Platforms - 2027")


def test_new_grad_unaffected_by_summer_rules():
    # summer rules only target internships / co-ops, never full-time new grad roles
    assert FILTERS.matches("Software Engineer, New Grad (Summer 2027 start)")
    assert FILTERS.matches("Software Engineer, New Grad 2027")
    assert FILTERS.matches("University Grad Software Engineer 2027 (USA)")
    assert not FILTERS.matches("Summer Analyst, Engineering (2027)", check_include=False)


def test_lists_skip_include_but_keep_exclude():
    assert FILTERS.matches("iOS Engineer 1", check_include=False)
    assert not FILTERS.matches("Senior iOS Engineer", check_include=False)
    assert not FILTERS.matches("Firmware Engineer II", check_include=False)
    assert not FILTERS.matches("Data Scientist 3", check_include=False)


def test_repo_config_loads():
    companies = load_companies(ROOT / "config/companies.yaml")
    assert companies and all(c.tier in ("reach", "volume", "midwest") for c in companies)
    assert load_lists(ROOT / "config/lists.yaml")


def test_bad_ats_rejected(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("companies:\n  - {name: X, ats: icims, token: x, tier: A}\n")
    with pytest.raises(ConfigError, match="ats must be"):
        load_companies(p)


def test_bad_tier_rejected(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("companies:\n  - {name: X, ats: lever, token: x, tier: S}\n")
    with pytest.raises(ConfigError, match="tier"):
        load_companies(p)


def test_duplicate_rejected(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("companies:\n  - {name: X, ats: lever, token: x}\n  - {name: Y, ats: lever, token: x}\n")
    with pytest.raises(ConfigError, match="duplicate"):
        load_companies(p)


def test_software_only_companies_need_a_software_role(tmp_path):
    from job_radar.config import load_companies, load_filters
    from pathlib import Path
    cfg = Path(__file__).resolve().parents[2] / "config"
    f = load_filters(cfg / "filters.yaml")
    assert f.matches("Software Engineer - New College Grad 2027", software_only=True)
    assert f.matches("Data Scientist, New Grad 2027", software_only=True)
    assert not f.matches("ASIC Design Engineer - New College Grad 2027", software_only=True)
    assert not f.matches("2027 Co-op – Mechanical Engineer", software_only=True)
    assert f.matches("ASIC Design Engineer - New College Grad 2027")  # other companies keep today's rules
    p = tmp_path / "c.yaml"
    p.write_text("companies:\n"
                 "  - { name: NVIDIA, ats: workday, token: nvidia.wd5/Site, tier: reach }\n"
                 "  - { name: Stripe, ats: greenhouse, token: stripe, tier: reach }\n"
                 "  - { name: SpaceX, ats: greenhouse, token: spacex, tier: reach, software_only: true }\n")
    assert [c.software_only for c in load_companies(p)] == [True, False, True]
