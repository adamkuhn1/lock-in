from datetime import date, timedelta
from lockin_worker.engine import ProblemState
from lockin_worker.levels import Attempt, topic_level

T = date(2026, 11, 30)
TOPIC = "Sliding Window"

def a(slug, diff, rating, days_ago=1, slot="new", ib=0):
    return Attempt(slug, TOPIC, diff, rating, T - timedelta(days=days_ago), slot, ib)

def lvl(attempts, prev="learning", prereqs=("practicing",), states=None, nc150=None, easy_pool=6):
    return topic_level(prev=prev, attempts=attempts, easy_pool=easy_pool, nc150=nc150 or set(),
                       states=states or {}, prereq_levels=list(prereqs), today=T)

def test_locked_vs_available_without_attempts():
    assert lvl([], prereqs=("learning",)) == "locked"
    assert lvl([], prereqs=("practicing",)) == "available"
    assert lvl([], prereqs=()) == "available"

def test_attempt_overrides_lock():
    assert lvl([a("e1", "Easy", "help")], prereqs=("locked",)) == "learning"

def test_practicing():
    att = [a("e1","Easy","nailed"), a("e2","Easy","struggled"), a("e3","Easy","nailed"),
           a("m1","Medium","nailed"), a("m2","Medium","struggled")]
    assert lvl(att) == "practicing"

def test_practicing_with_small_easy_pool():
    att = [a("e1","Easy","nailed"), a("m1","Medium","nailed"), a("m2","Medium","nailed")]
    assert lvl(att, easy_pool=1) == "practicing"

def _solid_attempts():
    att = [a(f"e{i}","Easy","nailed", 40) for i in range(3)]
    att += [a(f"m{i}","Medium","nailed", 30 - i) for i in range(6)]
    att += [a(f"m{i}","Medium","nailed", 10 - i, ib=7) for i in range(3)]  # spaced re-solves
    return att

def test_solid():
    assert lvl(_solid_attempts()) == "solid"

def test_not_solid_without_spaced_resolves():
    att = [a(f"e{i}","Easy","nailed") for i in range(3)] + [a(f"m{i}","Medium","nailed") for i in range(6)]
    assert lvl(att) == "practicing"

def test_solid_hysteresis():
    att = _solid_attempts() + [a("m7","Medium","struggled", 1), a("m8","Medium","struggled", 0)]
    assert lvl(att, prev="practicing") == "practicing"   # 3/5 recent: not enough to reach solid
    assert lvl(att, prev="solid") == "solid"             # but enough to stay solid

def test_mastered():
    att = _solid_attempts() + [a("h1","Hard","struggled", 2),
          a("x1","Medium","nailed", 3, slot="mystery"), a("x2","Medium","nailed", 2, slot="mystery")]
    nc = {"m0", "m1", "m2", "m3"}
    states = {s: ProblemState(s, "reviewing", 21) for s in ["m0", "m1", "m2"]}
    assert lvl(att, nc150=nc, states=states) == "mastered"
    states.pop("m2")  # only 2/4 = 50% at 21d+
    assert lvl(att, nc150=nc, states=states) == "solid"

def test_mastered_decays_on_lapses():
    att = _solid_attempts() + [a("m1","Medium","help", 3), a("m2","Medium","help", 2)]
    assert lvl(att, prev="mastered") != "mastered"

def test_mastered_decays_without_recent_nailed():
    att = [x for x in _solid_attempts()]
    old = [Attempt(x.slug, x.topic, x.difficulty, x.rating, x.on - timedelta(days=60), x.slot, x.interval_before) for x in att]
    assert lvl(old, prev="mastered") != "mastered"

def _mastered_qualifying():
    return _solid_attempts() + [a("h1","Hard","struggled", 2),
          a("x1","Medium","nailed", 3, slot="mystery"), a("x2","Medium","nailed", 2, slot="mystery")]

def test_decayed_topic_does_not_repromote():
    # Mastered-qualifying history, but two 'help' attempts within 30 days trip the decay gate.
    att = _mastered_qualifying() + [a("m7","Medium","help", 1), a("m8","Medium","help", 0)]
    assert lvl(att, prev="solid") == "solid"

def test_mastered_stays_mastered_when_healthy():
    nc = {"m0", "m1", "m2", "m3"}
    states = {s: ProblemState(s, "reviewing", 21) for s in ["m0", "m1", "m2"]}
    assert lvl(_mastered_qualifying(), prev="mastered", nc150=nc, states=states) == "mastered"
