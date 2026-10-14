import os
import pytest
import subprocess
from pathlib import Path
from lockin_worker import resume


def nosleep(s):
    pass


def ok_run(argv, **kw):
    return subprocess.CompletedProcess(argv, 0, "", "")


def make(root: Path, folder: str, files=("Adam_Kuhn_Resume.pdf",), mtime: int = 1_700_000_000) -> Path:
    d = root / folder
    d.mkdir(parents=True)
    for f in files:
        (d / f).write_text("x")
    os.utime(d, (mtime, mtime))
    return d


def tree(tmp_path):
    root = tmp_path / "Adam_Kuhn_Resumes"
    make(root, "Base_Resume")
    return root


def test_normalize_company():
    assert resume.normalize_company("Stripe, Inc.") == "stripe"
    assert resume.normalize_company("The Trade Desk") == "trade_desk"
    assert resume.normalize_company("JPMorgan Chase & Co.") == "jpmorgan_chase"
    assert resume.normalize_company("Palantir Technologies") == "palantir"
    assert resume.normalize_company("AT&T") == "at_t"
    assert resume.normalize_company("scale-ai") == "scale_ai"
    assert resume.normalize_company("  ") == ""


def test_folder_matches():
    assert resume.folder_matches("Amazon_SDE_Intern_2027", "amazon")
    assert resume.folder_matches("American_Express_2027_SWE", "american_express")
    assert resume.folder_matches("JP_Morgan_SWE", "jpmorgan")
    assert not resume.folder_matches("Applied_Systems_Associate_Software_Engineer", "apple")
    assert not resume.folder_matches("Amazon_SDE_Intern_2027", "amaz")


def test_company_from_url():
    f = resume.company_from_url
    assert f("https://boards.greenhouse.io/stripe/jobs/123") == "stripe"
    assert f("https://job-boards.greenhouse.io/scaleai/jobs/9") == "scaleai"
    assert f("https://boards.greenhouse.io/embed/job_app?for=ramp&token=1") == "ramp"
    assert f("https://jobs.lever.co/palantir/abc") == "palantir"
    assert f("https://jobs.ashbyhq.com/ramp/xyz") == "ramp"
    assert f("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x") == "nvidia"
    assert f("https://www.amazon.jobs/en/jobs/123") == "amazon"
    assert f("https://careers.microsoft.com/us/en/job/1") == "microsoft"
    assert f("not a url") is None


def test_single_match_prefers_pdf(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE_Intern_2027", files=("Adam_Kuhn_Resume.tex", "Adam_Kuhn_Resume.pdf"))
    c = resume.find_resume(root, "Stripe", run=ok_run)
    assert c.path == root / "Stripe_SWE_Intern_2027" / "Adam_Kuhn_Resume.pdf"
    assert c.note == "Matched resume folder Stripe_SWE_Intern_2027."


def test_tex_when_no_pdf(tmp_path):
    root = tree(tmp_path)
    make(root, "Ramp_SWE", files=("resume.tex",))
    assert resume.find_resume(root, "Ramp", run=ok_run).path.name == "resume.tex"


def test_multiple_matches_newest_and_lists_others(tmp_path):
    root = tree(tmp_path)
    make(root, "Amazon_Annapurna_SDE_I_Early_Career_2027", mtime=1_700_000_000)
    make(root, "Amazon_SDE_Intern_2027", mtime=1_800_000_000)
    c = resume.find_resume(root, "Amazon", run=ok_run)
    assert c.folder.name == "Amazon_SDE_Intern_2027"
    assert "Other matches" in c.note and "Amazon_Annapurna_SDE_I_Early_Career_2027" in c.note


def test_no_match_uses_base(tmp_path):
    root = tree(tmp_path)
    c = resume.find_resume(root, "Figma", run=ok_run)
    assert c.path == root / "Base_Resume" / "Adam_Kuhn_Resume.pdf" and c.folder is None
    assert "No resume folder for Figma" in c.note and "base resume" in c.note


def test_unknown_company_uses_base(tmp_path):
    c = resume.find_resume(tree(tmp_path), None, run=ok_run)
    assert "Company unknown" in c.note


def test_icloud_placeholder_downloaded(tmp_path):
    root = tree(tmp_path)
    d = make(root, "Stripe_SWE", files=(".Adam_Kuhn_Resume.pdf.icloud",))
    target = d / "Adam_Kuhn_Resume.pdf"

    def brctl(argv, **kw):
        assert argv == ["brctl", "download", str(target)]
        target.write_text("pdf")
        return subprocess.CompletedProcess(argv, 0, "", "")

    assert resume.find_resume(root, "Stripe", run=brctl).path == target


def test_icloud_download_fails_falls_back(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE", files=(".Adam_Kuhn_Resume.pdf.icloud",))

    def missing_brctl(argv, **kw):
        raise FileNotFoundError("brctl")

    c = resume.find_resume(root, "Stripe", run=missing_brctl, sleep=nosleep)
    assert c.path.parent.name == "Base_Resume" and "couldn't be downloaded" in c.note


def test_unreadable_root_falls_back(tmp_path):
    c = resume.find_resume(tmp_path / "does-not-exist", "Stripe", run=ok_run, sleep=nosleep)
    assert c.path.name == "Adam_Kuhn_Resume.pdf" and "Couldn't read" in c.note


def test_folder_without_resume_file(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE", files=("notes.txt",))
    assert "has no .pdf or .tex" in resume.find_resume(root, "Stripe", run=ok_run).note


def test_tilde_root_expanded(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    make(tmp_path / "R", "Stripe_SWE")
    assert resume.find_resume("~/R", "Stripe", run=ok_run).folder == tmp_path / "R" / "Stripe_SWE"


def test_brctl_download_is_polled(tmp_path):
    root = tree(tmp_path)
    d = make(root, "Stripe_SWE", files=(".Adam_Kuhn_Resume.pdf.icloud",))
    target = d / "Adam_Kuhn_Resume.pdf"
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        if len(sleeps) == 3:
            target.write_text("pdf")

    c = resume.find_resume(root, "Stripe", run=ok_run, sleep=sleep)
    assert c.path == target and len(sleeps) == 3


def test_brctl_never_lands_gives_up_after_budget(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE", files=(".Adam_Kuhn_Resume.pdf.icloud",))
    sleeps = []
    c = resume.find_resume(root, "Stripe", run=ok_run, sleep=sleeps.append)
    assert "couldn't be downloaded" in c.note and len(sleeps) == 30


@pytest.mark.skipif(os.geteuid() == 0, reason="root ignores chmod")
def test_permission_denied_root_falls_back(tmp_path):
    root = tree(tmp_path)
    os.chmod(root, 0)
    try:
        c = resume.find_resume(root, "Stripe", run=ok_run, sleep=nosleep)
    finally:
        os.chmod(root, 0o755)
    assert c.folder is None and c.path.name == "Adam_Kuhn_Resume.pdf"
    assert "Couldn't read" in c.note and "couldn't be read either" in c.note


def test_role_ranks_matches(tmp_path):
    root = tree(tmp_path)
    make(root, "Stripe_SWE_Intern_Winter", mtime=1_700_000_000)
    make(root, "Stripe_Software_Engineer_New_Grad", mtime=1_750_000_000)
    make(root, "Stripe_Operations_Associate_New_Grad_Mexico", mtime=1_800_000_000)
    c = resume.find_resume(root, "Stripe", role="Software Engineer, New Grad", run=ok_run)
    assert c.folder.name == "Stripe_Software_Engineer_New_Grad"
    assert "Stripe_Operations_Associate_New_Grad_Mexico" in c.note
    c = resume.find_resume(root, "Stripe", role=None, run=ok_run)
    assert c.folder.name == "Stripe_Operations_Associate_New_Grad_Mexico"


def test_ensure_local_permission_error_returns_false_without_brctl(monkeypatch):
    def boom(self):
        raise PermissionError("TCC")
    monkeypatch.setattr(Path, "exists", boom)
    def run(*a, **k):
        raise AssertionError("brctl must not run")
    def sleep(_):
        raise AssertionError("must not poll")
    assert resume.ensure_local(Path("/x/y.pdf"), run, sleep) is False
