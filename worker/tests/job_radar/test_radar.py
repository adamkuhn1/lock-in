from datetime import datetime
from pathlib import Path

from job_radar import state as state_mod
from job_radar.config import Company, GitHubList, load_filters
from job_radar.models import FetchError, Job
from job_radar.notify import Notifier
from job_radar.radar import ET, MAX_INDIVIDUAL_ALERTS, build_sources, run

FILTERS = load_filters(Path(__file__).parent.parent / "config/filters.yaml")
STRIPE = Company("Stripe", "greenhouse", "stripe", "A")
LYFT = Company("Lyft", "greenhouse", "lyft", "B")
NG = GitHubList("NG", "SimplifyJobs/New-Grad-Positions", [], "B")
MORNING = datetime(2026, 10, 6, 7, 0, tzinfo=ET)  # before the 9am ping
LATER = datetime(2026, 10, 6, 8, 30, tzinfo=ET)


def job(i, title="Software Engineer, New Grad", company="Stripe", loc="SF"):
    return Job(company, title, loc, f"https://example.com/{company}/{i}", None, str(i))


class Board:
    """Programmable fetch(): board.jobs[key] = list | Exception."""

    def __init__(self, **jobs):
        self.jobs = jobs

    def __call__(self, src, session, prev_sha):
        value = self.jobs.get(src.key, [])
        if isinstance(value, Exception):
            raise value
        return (value, "sha1" if src.key.startswith("github:") else None)


def go(board, state, now=LATER, companies=(STRIPE,), lists=(), notifier=None):
    notifier = notifier or Notifier(None, dry_run=True)
    summary = run(sources=build_sources(list(companies), list(lists)), filters=FILTERS, state=state,
                  notifier=notifier, now=now, fetch=board, log=lambda *_: None)
    return summary, notifier.sent


def test_first_run_marks_everything_seen_and_sends_nothing():
    state = state_mod.empty()
    summary, sent = go(Board(**{"greenhouse:stripe": [job(1), job(2)]}), state,
                       now=datetime(2026, 10, 6, 10, 0, tzinfo=ET))
    assert summary["first_run"] and sent == []
    assert set(state["sources"]["greenhouse:stripe"]["seen"]) == {"1", "2"}
    assert state["daily"]["last_ping_date"] == "2026-10-06"  # no ping right after setup


def test_new_matching_job_alerts_with_tier_priority():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": [job(1)], "greenhouse:lyft": []})
    go(board, state, MORNING, companies=(STRIPE, LYFT))
    # outside the preferred cities, so priority comes from tier alone
    board.jobs["greenhouse:stripe"] = [job(1), job(2, "Software Engineer Intern (Winter 2027)", loc="Seattle, WA")]
    board.jobs["greenhouse:lyft"] = [job(9, "New Grad SWE", company="Lyft", loc="Denver, CO")]
    summary, sent = go(board, state, LATER, companies=(STRIPE, LYFT))
    assert summary["alerted"] == 2
    stripe = next(s for s in sent if s["title"].startswith("Stripe"))
    assert stripe == {"title": "Stripe — Software Engineer Intern (Winter 2027)",
                      "message": "Seattle, WA\nPost time not published by this board",
                      "click": "https://example.com/Stripe/2", "priority": "high", "tags": []}
    lyft = next(s for s in sent if s["title"].startswith("Lyft"))
    assert lyft["priority"] == "default"
    # and not again next run
    _, sent = go(board, state, LATER, companies=(STRIPE, LYFT))
    assert sent == []


def test_alert_body_has_exact_posted_time():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": []})
    go(board, state, MORNING)
    board.jobs["greenhouse:stripe"] = [
        Job("Stripe", "Software Engineer, New Grad", "SF", "https://x/1", "2026-10-06T08:16:00-04:00", "1")]
    _, sent = go(board, state, LATER)  # 8:30 ET
    assert sent[0]["message"] == "SF\nPosted Oct 6, 8:16 AM ET (14 min ago)"


def test_non_matching_jobs_are_marked_seen_silently():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": []})
    go(board, state, MORNING)
    board.jobs["greenhouse:stripe"] = [job(3, "Senior Software Engineer"), job(4, "Account Executive")]
    _, sent = go(board, state)
    assert sent == []
    assert {"3", "4"} <= set(state["sources"]["greenhouse:stripe"]["seen"])


def test_newly_added_company_is_seeded_without_alerts():
    state = state_mod.empty()
    go(Board(**{"greenhouse:stripe": [job(1)]}), state, MORNING)
    board = Board(**{"greenhouse:stripe": [job(1)], "greenhouse:lyft": [job(5, company="Lyft")]})
    summary, sent = go(board, state, LATER, companies=(STRIPE, LYFT))
    assert not summary["first_run"] and sent == []
    assert "5" in state["sources"]["greenhouse:lyft"]["seen"]


def test_fetch_error_alerts_once_low_priority_then_recovers():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": [job(1)], "greenhouse:lyft": [job(5, company="Lyft")]})
    go(board, state, MORNING, companies=(STRIPE, LYFT))
    board.jobs["greenhouse:lyft"] = FetchError("HTTP 404 from https://boards-api...")
    _, sent = go(board, state, LATER, companies=(STRIPE, LYFT))
    assert len(sent) == 1
    assert sent[0]["priority"] == "low" and "Lyft" in sent[0]["title"] and "404" in sent[0]["message"]
    assert "5" in state["sources"]["greenhouse:lyft"]["seen"]  # state kept while failing
    _, sent = go(board, state, LATER, companies=(STRIPE, LYFT))
    assert sent == []  # still failing → no repeat
    board.jobs["greenhouse:lyft"] = [job(5, company="Lyft")]
    go(board, state, LATER, companies=(STRIPE, LYFT))
    assert state["failing"] == {}


def test_unexpected_exception_is_reported_not_crashing():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": [job(1)]})
    go(board, state, MORNING)
    board.jobs["greenhouse:stripe"] = KeyError("id")
    summary, sent = go(board, state)
    assert summary["errors"] == 1 and "KeyError" in sent[0]["message"]


def test_daily_ping_once_after_9am_et_with_count():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": []})
    go(board, state, datetime(2026, 10, 5, 22, 0, tzinfo=ET))  # first run, evening before
    board.jobs["greenhouse:stripe"] = [job(1), job(2, "Spring Intern")]
    _, sent = go(board, state, datetime(2026, 10, 6, 8, 30, tzinfo=ET))
    assert len(sent) == 2
    _, sent = go(board, state, datetime(2026, 10, 6, 9, 3, tzinfo=ET))
    assert sent[-1]["title"] == "radar alive: 2 new today"
    _, sent = go(board, state, datetime(2026, 10, 6, 9, 33, tzinfo=ET))
    assert sent == []  # only once per day
    _, sent = go(board, state, datetime(2026, 10, 7, 9, 2, tzinfo=ET))
    assert sent[-1]["title"] == "radar alive: 0 new today"


def test_same_posting_from_two_sources_alerts_once():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": [], "github:SimplifyJobs/New-Grad-Positions": []})
    go(board, state, MORNING, lists=(NG,))
    board.jobs["greenhouse:stripe"] = [job(7, "Software Engineer, New Grad")]
    board.jobs["github:SimplifyJobs/New-Grad-Positions"] = [
        Job("🔥 Stripe", "Software Engineer - New Grad", "SF", "https://x", None, "uuid-1")]
    _, sent = go(board, state, LATER, lists=(NG,))
    assert len(sent) == 1 and sent[0]["priority"] == "high"
    assert "uuid-1" in state["sources"]["github:SimplifyJobs/New-Grad-Positions"]["seen"]


def test_list_rows_use_company_tier_and_skip_include_filter():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": [], "github:SimplifyJobs/New-Grad-Positions": []})
    go(board, state, MORNING, lists=(NG,))
    board.jobs["github:SimplifyJobs/New-Grad-Positions"] = [
        Job("Whoop", "iOS Engineer 1", "Boston, MA", "https://w", None, "u-2"),
        Job("Stripe", "Backend Engineer", "SF", "https://s", None, "u-3"),
        Job("Acme", "Senior Engineer", "SF", "https://a", None, "u-4"),
    ]
    _, sent = go(board, state, LATER, lists=(NG,))
    by_title = {s["title"]: s["priority"] for s in sent}
    assert by_title == {"Whoop — iOS Engineer 1": "default", "Stripe — Backend Engineer": "high"}


def test_failed_send_is_retried_next_run():
    class Flaky(Notifier):
        fail = True

        def send(self, title, message, **kw):
            if self.fail and "—" in title:
                raise RuntimeError("ntfy down")
            super().send(title, message, **kw)

    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": []})
    go(board, state, MORNING)
    board.jobs["greenhouse:stripe"] = [job(1)]
    n = Flaky(None, dry_run=True)
    summary, _ = go(board, state, LATER, notifier=n)
    assert summary["notify_failures"] == 1 and n.sent == []
    n.fail = False
    _, sent = go(board, state, LATER, notifier=n)
    assert [s["title"] for s in sent] == ["Stripe — Software Engineer, New Grad"]


def test_burst_is_capped_with_summary():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": []})
    go(board, state, MORNING)
    board.jobs["greenhouse:stripe"] = [job(i, f"New Grad Engineer #{i}") for i in range(MAX_INDIVIDUAL_ALERTS + 5)]
    summary, sent = go(board, state)
    assert len(sent) == MAX_INDIVIDUAL_ALERTS + 1
    assert sent[-1]["title"] == "job-radar: +5 more new postings"
    assert summary["alerted"] == MAX_INDIVIDUAL_ALERTS + 5


def test_unchanged_readme_is_not_pruned_or_rediffed():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": [], "github:SimplifyJobs/New-Grad-Positions": [
        Job("A", "New Grad", "X", "https://a", None, "u-1")]})
    go(board, state, MORNING, lists=(NG,))
    board.jobs["github:SimplifyJobs/New-Grad-Positions"] = None  # sha unchanged
    _, sent = go(board, state, LATER, lists=(NG,))
    assert sent == []
    assert "u-1" in state["sources"]["github:SimplifyJobs/New-Grad-Positions"]["seen"]


def test_state_roundtrip(tmp_path):
    state = state_mod.empty()
    go(Board(**{"greenhouse:stripe": [job(1)]}), state, MORNING)
    path = tmp_path / "data/seen.json"
    state_mod.save(state, path)
    assert state_mod.load(path) == state


def test_recent_sends_newest_n_without_touching_state():
    from job_radar.radar import recent
    jobs = [
        Job("Stripe", "New Grad SWE", "SF", "https://x/1", "2026-10-06T08:00:00-04:00", "1"),
        Job("Stripe", "New Grad SWE", "NYC", "https://x/2", "2026-10-06T07:00:00-04:00", "2"),  # dup title
        Job("Stripe", "Winter Intern", "SF", "https://x/3", "2026-10-05T08:00:00-04:00", "3"),
        Job("Stripe", "Summer Intern", "SF", "https://x/6", "2026-10-06T08:30:00-04:00", "6"),
        Job("Stripe", "Senior Engineer", "SF", "https://x/4", "2026-10-06T08:20:00-04:00", "4"),
        Job("Stripe", "Spring Intern", "SF", "https://x/5", None, "5"),  # no time → unrankable
    ]
    n = Notifier(None, dry_run=True)
    picked = recent(sources=build_sources([STRIPE], []), filters=FILTERS, notifier=n, n=2,
                    now=LATER, fetch=Board(**{"greenhouse:stripe": jobs}), log=lambda *_: None)
    assert [j.id for j in picked] == ["1", "3"]
    assert [s["title"] for s in n.sent] == ["Stripe — Winter Intern", "Stripe — New Grad SWE"]  # newest last


OFF = GitHubList("Off", "SimplifyJobs/Summer2027-Internships", [], "B",
                 path="README-Off-Season.md", terms=["Winter", "Spring"])
OFF_KEY = "github:SimplifyJobs/Summer2027-Internships:README-Off-Season.md"


def test_offseason_only_winter_spring_alert_and_term_in_body():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": [], OFF_KEY: []})
    go(board, state, MORNING, lists=(OFF,))
    board.jobs[OFF_KEY] = [
        Job("Figure", "Middleware Software Intern", "San Jose, CA", "https://f", None, "a", "0d", "Winter 2027"),
        Job("Tesla", "UI Intern", "Palo Alto, CA", "https://t", None, "b", "0d", "Winter 2027, Spring 2027"),
        Job("GovSignals", "Engineering Intern", "Remote", "https://g", None, "c", "0d", "Fall 2026"),
    ]
    _, sent = go(board, state, LATER, lists=(OFF,))
    assert {s["title"] for s in sent} == {"Figure — Middleware Software Intern", "Tesla — UI Intern"}
    figure = next(s for s in sent if s["title"].startswith("Figure"))
    assert figure["message"].startswith("Winter 2027 · San Jose, CA\n")
    # the Fall row is recorded as seen, so widening `terms` later won't flood
    assert "c" in state["sources"][OFF_KEY]["seen"]


def test_repo_lists_watch_offseason_winter_spring():
    from job_radar.config import load_lists
    lists = load_lists(Path(__file__).parent.parent / "config/lists.yaml")
    off = [g for g in lists if g.path == "README-Off-Season.md"]
    assert off and {"Winter", "Spring"} <= set(off[0].terms)
    # summer list intentionally not watched
    assert "github:SimplifyJobs/Summer2027-Internships" not in {g.key for g in lists}


# ---- US-only location filter ----

def test_non_us_jobs_never_alert_and_are_marked_seen():
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": []})
    go(board, state, MORNING)
    board.jobs["greenhouse:stripe"] = [
        job(1, "New Grad SWE, Payments", loc="London, UK"),
        job(2, "New Grad SWE, Billing", loc="Toronto, ON, CA"),
        job(3, "New Grad SWE, Risk", loc="Bengaluru"),
        job(4, "New Grad SWE, Identity", loc="Remote, Canada; Remote, United States"),  # US is an option
        job(5, "New Grad SWE, Terminal", loc="Denver, CO"),
    ]
    summary, sent = go(board, state)
    assert sorted(s["message"].split("\n")[0] for s in sent) == ["Denver, CO", "Remote, Canada; Remote, United States"]
    assert summary["alerted"] == 2
    assert {"1", "2", "3"} <= set(state["sources"]["greenhouse:stripe"]["seen"])


def test_office_hint_decides_vague_location():
    """Greenhouse "Hybrid" with offices → the offices decide."""
    state = state_mod.empty()
    board = Board(**{"greenhouse:stripe": []})
    go(board, state, MORNING)
    board.jobs["greenhouse:stripe"] = [
        Job("Stripe", "Software Engineer, New Grad", "Hybrid", "https://x/1", None, "1", places=("Singapore",)),
        Job("Stripe", "Software Engineer, New Grad", "Hybrid", "https://x/2", None, "2", places=("Austin, TX",)),
    ]
    _, sent = go(board, state)
    assert [s["click"] for s in sent] == ["https://x/2"]


def test_preferred_city_alerts_first_with_star_and_high_priority():
    state = state_mod.empty()
    board = Board(**{"greenhouse:lyft": []})
    go(board, state, MORNING, companies=(LYFT,))
    board.jobs["greenhouse:lyft"] = [
        job(1, "Software Engineer, New Grad", company="Lyft", loc="Seattle, WA"),
        job(2, "Early Career Engineer", company="Lyft", loc="Chicago, IL"),
    ]
    _, sent = go(board, state, companies=(LYFT,))
    assert [s["message"].split("\n")[0] for s in sent] == ["Chicago, IL", "Seattle, WA"]
    assert sent[0]["priority"] == "high" and sent[0]["tags"] == ["star"]
    assert sent[1]["priority"] == "default" and sent[1]["tags"] == []
