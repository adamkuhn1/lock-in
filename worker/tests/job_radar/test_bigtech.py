import json

import pytest

from job_radar.fetchers import amazon, apple, eightfold, google
from job_radar.models import FetchError


def test_amazon_parse_and_dates():
    payload = {"hits": 1, "jobs": [{"id_icims": "10567489", "title": " Software Development Engineer, Early Career - 2027 ",
                                    "normalized_location": "Seattle, Washington, USA", "country_code": "USA",
                                    "job_path": "/en/jobs/10567489/sde", "posted_date": "October  9, 2026"},
                                   {"title": "no path"}]}
    [j] = amazon.parse(payload, "Amazon")
    assert (j.id, j.title, j.url) == ("10567489", "Software Development Engineer, Early Career - 2027", "https://www.amazon.jobs/en/jobs/10567489/sde")
    assert j.posted_at.startswith("2026-10-09") and j.places == ("USA",)
    assert amazon.posted_at("soon") is None
    with pytest.raises(FetchError, match="Result limit"):
        amazon.parse({"error": "Result limit cannot be greater than 100", "jobs": None}, "Amazon")


def test_eightfold_parse_and_token():
    payload = {"data": {"count": 15, "positions": [{"id": 1970393557026652, "name": "Software Engineer",
                                                    "standardizedLocations": ["Redmond, WA, US"], "postedTs": 1760500000,
                                                    "positionUrl": "/careers/job/1970393557026652"}]}}
    [j], total = eightfold.parse(payload, "Microsoft", "apply.careers.microsoft.com")
    assert total == 15 and j.url == "https://apply.careers.microsoft.com/careers/job/1970393557026652"
    assert j.location == "Redmond, WA, US" and j.posted_at.startswith("2025-10-15")
    assert eightfold.parse_token("apply.careers.microsoft.com/microsoft.com") == ("apply.careers.microsoft.com", "microsoft.com")
    with pytest.raises(FetchError):
        eightfold.parse_token("microsoft.com")
    with pytest.raises(FetchError):
        eightfold.parse({"data": {}}, "x", "h")


def test_google_parse_embedded_data():
    row = ["123", "Software Engineer, Early Career, 2027 Start", None, None, None, None, None, "Google", None,
           [["Mountain View, CA, USA", [], "Mountain View", "94043", "CA", "US"]], None, [2], [1760500000]]
    data = json.dumps([[row], None, 1, 20])
    html = f"<script>AF_initDataCallback({{key: 'ds:1', hash: '7', data:{data}, sideChannel: {{}}}});</script>"
    [j], total = google.parse(html, "Google")
    assert total == 1 and j.id == "123" and j.location == "Mountain View, CA, USA"
    assert j.url == "https://www.google.com/about/careers/applications/jobs/results/123"
    with pytest.raises(FetchError, match="layout changed"):
        google.parse("<html></html>", "Google")


def test_apple_parse_merges_location_rows():
    rows = [{"positionId": "200664000", "postingTitle": "Software Engineering Internship (Winter 2027)", "postDateInGMT": "2026-10-01T00:00:00Z",
             "transformedPostingTitle": "swe-internship", "locations": [{"name": "Cupertino", "countryName": "United States"}]},
            {"positionId": "200664000", "postingTitle": "Software Engineering Internship (Winter 2027)",
             "transformedPostingTitle": "swe-internship", "locations": [{"name": "Austin", "countryName": "United States"}]}]
    blob = json.dumps(json.dumps({"loaderData": {"search": {"searchResults": rows, "totalRecords": 2}}}))
    [j], total = apple.parse(f"<script>window.__staticRouterHydrationData = JSON.parse({blob});</script>", "Apple")
    assert total == 2 and j.places == ("Cupertino, United States", "Austin, United States")
    assert j.url == "https://jobs.apple.com/en-us/details/200664000/swe-internship"


class FakeResp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def test_eightfold_entry_hint_skips_leveled_titles_and_keeps_partial_results(monkeypatch):
    from job_radar.config import Company
    monkeypatch.setattr(eightfold, "SLEEP", lambda s: None)
    calls = []

    def get(url, timeout, params, headers):
        calls.append(params["filter_seniority"])
        if len(calls) == 1:
            return FakeResp(200, {"data": {"count": 2, "positions": [
                {"id": 1, "name": "Software Engineer", "standardizedLocations": ["Redmond, WA, US"]},
                {"id": 2, "name": "Software Engineer II", "standardizedLocations": ["Redmond, WA, US"]}]}})
        return FakeResp(429, {})

    session = type("S", (), {"get": staticmethod(get)})()
    jobs = {j.id: j for j in eightfold.fetch(Company("Microsoft", "eightfold", "h.example/microsoft.com", "reach"), session)}
    assert jobs["1"].term == "Entry level" and jobs["2"].term is None
    assert calls == ["Entry", "Intern"]  # stopped at the 429, kept the first page


def test_eightfold_first_request_failure_raises(monkeypatch):
    from job_radar.config import Company
    session = type("S", (), {"get": staticmethod(lambda url, timeout, params, headers: FakeResp(429, {}))})()
    with pytest.raises(FetchError, match="429"):
        eightfold.fetch(Company("Microsoft", "eightfold", "h.example/microsoft.com", "reach"), session)


def test_meta_parse():
    from job_radar.fetchers import meta
    body = json.dumps({"data": {"job_search_with_featured_jobs": {"all_jobs": [
        {"id": "123", "title": "Software Engineer, University Grad", "locations": ["Menlo Park, CA", "New York, NY"]}, {"title": "no id"}]}}})
    [j] = meta.parse(body + "\n{\"extra\": 1}", "Meta")
    assert j.url == "https://www.metacareers.com/profile/job_details/123/" and j.places == ("Menlo Park, CA", "New York, NY")
    with pytest.raises(FetchError, match="DOC_ID"):
        meta.parse('{"errors": []}', "Meta")


def test_oracle_parse_and_links():
    from job_radar.fetchers import oracle
    payload = {"items": [{"TotalJobsCount": 1, "requisitionList": [
        {"Id": "210600", "Title": "2027 Software Engineer Program", "PrimaryLocation": "Chicago, IL, United States",
         "PostedDate": "2026-08-03", "secondaryLocations": [{"Name": "Columbus, OH, United States"}]}]}]}
    [j] = oracle.parse(payload, "JPMorgan Chase", "jpmc.fa.oraclecloud.com", "CX_1001")
    assert j.url == "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210600"
    assert j.places == ("Chicago, IL, United States", "Columbus, OH, United States") and j.posted_at.startswith("2026-08-03")
    [u] = oracle.parse(payload, "Uber", "iaziqy.fa.ocs.oraclecloud.com", "CX_1")
    assert u.url == "https://jobs.uber.com/en/jobs/210600/"
    assert oracle.parse({"items": []}, "x", "h", "s") == []
    with pytest.raises(FetchError):
        oracle.parse_token("jpmc.fa.oraclecloud.com/CX_1001")


def test_ibm_keeps_us_jobs_only():
    from job_radar.fetchers import ibm
    hits = {"total": {"value": 2}, "hits": [
        {"_id": "1", "_source": {"title": "Entry Level Software Developer 2027", "url": "https://careers.ibm.com/j/1", "field_keyword_19": "SAN JOSE, US", "dcdate": "2026-09-03"}},
        {"_id": "2", "_source": {"title": "Entry Level Software Developer 2027", "url": "https://careers.ibm.com/j/2", "field_keyword_19": "Markham, CA"}}]}
    [j] = ibm.parse(hits, "IBM")
    assert j.location == "San Jose, United States" and j.posted_at.startswith("2026-09-03")


def test_eightfold_v2_parse():
    payload = {"count": 1, "positions": [{"id": 7, "name": "Software Engineer Intern, Winter 2027", "locations": ["Los Gatos, California"],
                                          "t_create": 1760500000, "canonicalPositionUrl": "https://explore.jobs.netflix.net/careers/job/7"}]}
    [j], total = eightfold.parse_v2(payload, "Netflix", "explore.jobs.netflix.net")
    assert total == 1 and j.url.endswith("/careers/job/7") and j.location == "Los Gatos, California"
