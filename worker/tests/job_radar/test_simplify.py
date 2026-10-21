import pytest

from job_radar.config import GitHubList
from job_radar.fetchers import simplify
from job_radar.models import FetchError

from .conftest import FakeResponse, FakeSession, fixture_text

README = fixture_text("simplify_newgrad_README.md")
SRC = GitHubList("NG", "SimplifyJobs/New-Grad-Positions", ["Software Engineering"])
META_URL = "https://api.github.com/repos/SimplifyJobs/New-Grad-Positions/readme"
BLOB_URL = "https://api.github.com/repos/SimplifyJobs/New-Grad-Positions/git/blobs/abc123"


def _session():
    return FakeSession({
        META_URL: FakeResponse(200, {"sha": "abc123", "path": "README.md", "size": len(README)}),
        BLOB_URL: FakeResponse(200, text=README),
    })


def test_parses_open_rows_in_selected_sections():
    jobs = simplify.parse_readme(README, ["Software Engineering"])
    assert len(jobs) == 7
    assert jobs[0].company == "Southern Star Central Gas Pipeline"
    assert jobs[0].title == "Software Engineer 1"
    assert jobs[0].location == "Owensboro, KY"
    assert jobs[0].id == "52d14524-3436-4572-b566-794db4872e46"  # simplify posting id
    assert "simplify.jobs" not in jobs[0].url  # direct apply link preferred


def test_arrow_rows_inherit_company():
    jobs = simplify.parse_readme(README, ["Software Engineering"])
    whoop = [j for j in jobs if j.company == "Whoop"]
    assert len(whoop) == 3
    assert "↳" not in {j.company for j in jobs}


def test_closed_rows_skipped():
    jobs = simplify.parse_readme(README, ["Software Engineering"])
    assert all(j.url for j in jobs)
    assert "Plano, TX" not in {j.location for j in jobs}  # the closed JPMC row


def test_multi_location_details_cell():
    amazon = next(j for j in simplify.parse_readme(README) if "Amazon" in j.company)
    assert amazon.location.startswith("Seattle, WA; Jessup, MD")
    assert "locations" not in amazon.location


def test_row_without_simplify_link_keyed_by_apply_url():
    job = next(j for j in simplify.parse_readme(README) if j.company == "People Culture Talent")
    assert job.id.startswith("https://jobs.ashbyhq.com/") and "?" not in job.id


def test_section_filter():
    all_jobs = simplify.parse_readme(README)
    swe = simplify.parse_readme(README, ["Software Engineering"])
    pm = simplify.parse_readme(README, ["product management"])
    assert len(all_jobs) == len(swe) + len(pm)
    assert len(pm) == 2


def test_format_change_raises():
    with pytest.raises(FetchError, match="format"):
        simplify.parse_readme("# Totally new layout\n\n## Roles\n\n<table></table>\n")


def test_fetch_downloads_full_blob_and_returns_sha():
    session = _session()
    jobs, sha = simplify.fetch(SRC, session, prev_sha=None)
    assert sha == "abc123" and len(jobs) == 7
    assert [c[1] for c in session.calls] == [META_URL, BLOB_URL]
    assert session.calls[1][2]["Accept"] == "application/vnd.github.raw"


def test_fetch_skips_download_when_sha_unchanged():
    session = _session()
    jobs, sha = simplify.fetch(SRC, session, prev_sha="abc123")
    assert jobs is None and sha == "abc123"
    assert [c[1] for c in session.calls] == [META_URL]


def test_fetch_sends_github_token(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "t0k")
    session = _session()
    simplify.fetch(SRC, session, prev_sha=None)
    assert session.calls[0][2]["Authorization"] == "Bearer t0k"


def test_fetch_missing_repo_raises():
    with pytest.raises(FetchError, match="404"):
        simplify.fetch(GitHubList("x", "SimplifyJobs/Summer2099-Internships"), FakeSession(), None)


def test_links_point_at_listing_not_application_form():
    jobs = {}
    for j in simplify.parse_readme(README, ["Software Engineering"]):
        jobs.setdefault(j.company, j)  # first row per company
    whoop = jobs["Whoop"].url
    assert whoop == "https://jobs.ashbyhq.com/whoop/f9985943-da11-4cbd-9c44-d2f7e421f65e"
    sscgp = jobs["Southern Star Central Gas Pipeline"].url
    assert sscgp == "https://careers-sscgp.icims.com/jobs/3060/job?mobile=true&needsRedirect=false"
    assert all("utm_" not in j.url and "ref=Simplify" not in j.url for j in jobs.values())


@pytest.mark.parametrize("raw,clean", [
    ("https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000000/apply?lever-source=Simplify",
     "https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000000"),
    ("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=Simplify&utm_source=Simplify",
     "https://job-boards.greenhouse.io/acme/jobs/123"),
    ("https://acme.wd1.myworkdayjobs.com/Careers/job/NYC/SWE_R1?ref=Simplify",
     "https://acme.wd1.myworkdayjobs.com/Careers/job/NYC/SWE_R1"),
])
def test_listing_url(raw, clean):
    assert simplify.listing_url(raw) == clean


def test_age_captured():
    jobs = simplify.parse_readme(README, ["Software Engineering"])
    assert jobs[0].age == "0d"


def test_ids_unchanged_by_link_cleanup():
    # Ids must keep deriving from the raw link, or every row would re-alert.
    job = next(j for j in simplify.parse_readme(README) if j.company == "People Culture Talent")
    assert job.id == "https://jobs.ashbyhq.com/people-culture-talent/c1049c49-aea6-4862-a711-a4c78cf6e959"


OFFSEASON = fixture_text("simplify_offseason_README.md")


def test_offseason_terms_column_parsed_by_header():
    jobs = simplify.parse_readme(OFFSEASON, ["Software Engineering"])
    assert [j.term for j in jobs] == ["Winter 2027", "Spring 2027", "Fall 2026", "Winter 2027, Spring 2027"]
    figure = jobs[0]
    assert (figure.company, figure.title, figure.location, figure.age) == \
        ("Figure", "Middleware Software Intern", "San Jose, CA", "0d")
    assert figure.url == "https://job-boards.greenhouse.io/figureai/jobs/4605724006"  # not the "Terms" cell


def test_regular_readme_has_no_term():
    assert all(j.term is None for j in simplify.parse_readme(README))


def test_fetch_non_readme_path_uses_contents_api():
    src = GitHubList("Off", "SimplifyJobs/Summer2027-Internships", [], path="README-Off-Season.md")
    base = "https://api.github.com/repos/SimplifyJobs/Summer2027-Internships"
    session = FakeSession({
        f"{base}/contents/README-Off-Season.md": FakeResponse(200, {"sha": "off1", "size": 1}),
        f"{base}/git/blobs/off1": FakeResponse(200, text=OFFSEASON),
    })
    jobs, sha = simplify.fetch(src, session, None)
    assert sha == "off1" and len(jobs) == 4
    assert src.key == "github:SimplifyJobs/Summer2027-Internships:README-Off-Season.md"


MARKDOWN_LIST = """
## 2027 USA SWE New Graduate Positions

### FAANG+

| Company | Position | Location | Salary | Posting | Age |
|---|---|---|---|---|---|
| <a href="https://www.lyft.com"><strong>Lyft</strong></a> | Software Engineer | San Francisco, CA | $206k/yr | <a href="https://jobs.lever.co/lyft/abc/apply?utm_source=x"><img alt="Apply"/></a> | 3d |
| ↳ | Backend Engineer | NYC</br>Austin, TX | $190k/yr | <a href="https://jobs.lever.co/lyft/def"><img alt="Apply"/></a> | 1d |
| **[Acme](https://acme.com)** | Platform Engineer | Remote | | [Apply](https://boards.greenhouse.io/acme/jobs/1) | 0d |
| Closed Co | SWE | Boston, MA | | 🔒 | 9d |

Some text after the table.

## Contributors
| Name | Commits |
|---|---|
| someone | 5 |
"""


def test_parses_markdown_pipe_tables():
    from job_radar.fetchers.simplify import parse_readme
    jobs = parse_readme(MARKDOWN_LIST, [])
    assert [(j.company, j.title, j.url, j.age) for j in jobs] == [
        ("Lyft", "Software Engineer", "https://jobs.lever.co/lyft/abc", "3d"),
        ("Lyft", "Backend Engineer", "https://jobs.lever.co/lyft/def", "1d"),
        ("Acme", "Platform Engineer", "https://boards.greenhouse.io/acme/jobs/1", "0d"),
    ]
    assert jobs[1].location == "NYC; Austin, TX"


def test_markdown_section_filter():
    from job_radar.fetchers.simplify import parse_readme
    assert parse_readme(MARKDOWN_LIST, ["new graduate"])
    import pytest
    from job_radar.models import FetchError
    with pytest.raises(FetchError):
        parse_readme(MARKDOWN_LIST, ["contributors"])
