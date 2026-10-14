from datetime import date, timedelta
from lockin_worker.bank import Problem, Topic
from lockin_worker.daily import DailyInput, build_daily_set, choose_focus
from lockin_worker.engine import ProblemState

T = date(2026, 10, 20)
TOPICS = [Topic("A", 1, 0, (), ()), Topic("B", 2, 1, ("A",), ()), Topic("C", 3, 1, ("A",), ())]

def P(slug, diff, topic, lists=("nc150",), ac=50.0, paid=False):
    return Problem(slug, slug, diff, topic, lists, paid, ac, None)

def bank():
    out = {}
    for t in "ABC":
        for d, k in (("Easy", 4), ("Medium", 8), ("Hard", 3)):
            for i in range(k):
                p = P(f"{t}-{d[0]}{i}", d, t, ac=90 - i)
                out[p.slug] = p
    out["A-paid"] = P("A-paid", "Easy", "A", ac=99, paid=True)
    return out

def inp(**kw):
    base = dict(today=T, day_index=1, n=6, focus="A", focus_since=T, levels={"A": "learning", "B": "locked", "C": "locked"},
                states={}, attempted=frozenset(), lifetime_mediums=0)
    base.update(kw)
    return DailyInput(**base)

def test_learning_day_shape_and_order():
    plan = build_daily_set(inp(), bank(), TOPICS)
    diffs = [bank()[i.slug].difficulty for i in plan.items]
    assert len(plan.items) == 6
    assert diffs == sorted(diffs, key=["Easy", "Medium", "Hard"].index)
    assert all(bank()[i.slug].topic == "A" for i in plan.items)
    assert "A-paid" not in {i.slug for i in plan.items}
    assert plan.items[0].slug == "A-E0"  # nc150 first, then highest acRate
    assert not plan.mixed_day

def test_no_hard_before_30_mediums():
    plan = build_daily_set(inp(levels={"A": "solid", "B": "practicing", "C": "available"}, focus="B"), bank(), TOPICS)
    assert all(bank()[i.slug].difficulty != "Hard" for i in plan.items)

def test_reviews_capped_at_40_percent_and_first():
    states = {f"A-M{i}": ProblemState(f"A-M{i}", "reviewing", 3, T - timedelta(days=1)) for i in range(5)}
    plan = build_daily_set(inp(states=states, attempted=frozenset(states)), bank(), TOPICS)
    slots = [i.slot for i in plan.items]
    assert slots.count("review") == 2 and slots[:2] == ["review", "review"]

def test_mystery_slot_from_older_topic():
    levels = {"A": "practicing", "B": "practicing", "C": "available"}
    plan = build_daily_set(inp(levels=levels, focus="B"), bank(), TOPICS)
    myst = [i for i in plan.items if i.slot == "mystery"]
    assert len(myst) == 1 and bank()[myst[0].slug].topic != "B"
    assert bank()[myst[0].slug].difficulty == "Medium"

def test_mixed_day_every_7th():
    levels = {"A": "practicing", "B": "practicing", "C": "available"}
    plan = build_daily_set(inp(levels=levels, focus="B", day_index=6), bank(), TOPICS)
    assert plan.mixed_day and len(plan.items) == 6
    assert {i.slot for i in plan.items} <= {"mystery", "review"}

def test_focus_rotates_after_10_days():
    levels = {"A": "practicing", "B": "available", "C": "available"}
    f, since = choose_focus(inp(levels=levels, focus="A", focus_since=T - timedelta(days=10)), TOPICS)
    assert (f, since) == ("B", T)

def test_focus_kept_within_10_days():
    levels = {"A": "practicing", "B": "available", "C": "available"}
    f, since = choose_focus(inp(levels=levels, focus="A", focus_since=T - timedelta(days=3)), TOPICS)
    assert (f, since) == ("A", T - timedelta(days=3))

def test_topic_without_easy_falls_back_to_medium():
    b = {k: v for k, v in bank().items() if not (v.topic == "A" and v.difficulty == "Easy")}
    plan = build_daily_set(inp(), b, TOPICS)
    assert len(plan.items) == 6 and all(b[i.slug].difficulty in ("Medium", "Hard") for i in plan.items)

def test_weekly_spot_check_of_retained():
    states = {"A-M0": ProblemState("A-M0", "retained", 60, T + timedelta(days=30))}
    plan = build_daily_set(inp(day_index=3, states=states, attempted=frozenset(states)), bank(), TOPICS)
    assert (plan.items[0].slug, plan.items[0].slot) == ("A-M0", "spot")

def test_attempted_never_new():
    plan = build_daily_set(inp(attempted=frozenset({"A-E0", "A-E1"})), bank(), TOPICS)
    assert not {"A-E0", "A-E1"} & {i.slug for i in plan.items if i.slot == "new"}

def thin_pool_inp(lifetime_mediums):
    # focus A is practicing with every free Easy and Medium already attempted; B is eligible with unseen Mediums
    b = bank()
    attempted = frozenset(k for k, v in b.items() if v.topic == "A" and v.difficulty in ("Easy", "Medium") and not v.paid_only)
    return inp(levels={"A": "practicing", "B": "available", "C": "locked"}, focus="A",
               attempted=attempted, lifetime_mediums=lifetime_mediums), b

def test_thin_pool_no_hard_before_30_and_full_count():
    i, b = thin_pool_inp(0)
    plan = build_daily_set(i, b, TOPICS)
    assert len(plan.items) == i.n
    assert all(b[x.slug].difficulty != "Hard" for x in plan.items)
    assert {b[x.slug].topic for x in plan.items} == {"B"}
    assert all(x.slot == "new" for x in plan.items)

def test_thin_pool_hard_allowed_after_30():
    # I2 ruling: a focus with < 2 unseen Mediums now rotates, so the thin pool here is a focus that still has
    # exactly 2 Mediums and nowhere else to go; after 30 Mediums its Hards fill the remaining Medium slots.
    b = bank()
    i = inp(levels={"A": "practicing", "B": "solid", "C": "solid"}, focus="A",
            attempted=_all_but("A", "Medium", {"A-M6", "A-M7"}), lifetime_mediums=30)
    plan = build_daily_set(i, b, TOPICS)
    assert len(plan.items) == i.n and plan.focus == "A"
    assert any(b[x.slug].difficulty == "Hard" for x in plan.items)

def test_focus_rotates_to_next_not_first():
    levels = {"A": "practicing", "B": "available", "C": "available"}
    f, since = choose_focus(inp(levels=levels, focus="B", focus_since=T - timedelta(days=10)), TOPICS)
    assert (f, since) == ("C", T)

def _all_but(topic, diff, keep):
    return frozenset(k for k, v in bank().items() if v.topic == topic and v.difficulty == diff and k not in keep)

def test_exhausted_focus_rotates_even_when_fresh():
    levels = {"A": "practicing", "B": "available", "C": "available"}
    one_left = _all_but("A", "Medium", {"A-M7"})
    f, since = choose_focus(inp(levels=levels, focus="A", focus_since=T - timedelta(days=2), attempted=one_left),
                            TOPICS, bank())
    assert (f, since) == ("B", T)
    two_left = _all_but("A", "Medium", {"A-M6", "A-M7"})
    f, since = choose_focus(inp(levels=levels, focus="A", focus_since=T - timedelta(days=2), attempted=two_left),
                            TOPICS, bank())
    assert (f, since) == ("A", T - timedelta(days=2))

def test_exhausted_focus_with_nowhere_to_go_is_kept():
    levels = {"A": "practicing", "B": "solid", "C": "solid"}
    f, _ = choose_focus(inp(levels=levels, focus="A", attempted=_all_but("A", "Medium", set())), TOPICS, bank())
    assert f == "A"

def test_practicing_focus_short_on_mediums_tops_up_other_mediums_before_easies():
    b = bank()
    levels = {"A": "practicing", "B": "available", "C": "locked"}
    i = inp(levels=levels, focus="A", focus_since=T - timedelta(days=2),
            attempted=_all_but("A", "Medium", {"A-M6", "A-M7"}))
    plan = build_daily_set(i, b, TOPICS)
    assert plan.focus == "A" and len(plan.items) == 6
    got = [(b[x.slug].topic, b[x.slug].difficulty) for x in plan.items]
    assert got.count(("A", "Easy")) == 1   # only the ladder's own Easy slot
    assert got.count(("A", "Medium")) == 2
    assert sum(1 for t, d in got if t != "A" and d == "Medium") == 3

def test_practicing_focus_falls_back_to_own_easies_when_no_other_mediums():
    b = {k: v for k, v in bank().items() if v.topic == "A"}
    levels = {"A": "practicing", "B": "solid", "C": "solid"}
    i = inp(levels=levels, focus="A", attempted=_all_but("A", "Medium", {"A-M6", "A-M7"}))
    plan = build_daily_set(i, b, TOPICS)
    assert len(plan.items) == 6
    assert sorted(b[x.slug].difficulty for x in plan.items) == ["Easy"] * 4 + ["Medium"] * 2
