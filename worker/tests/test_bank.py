from lockin_worker.bank import load_bank, load_topics

def test_bank_loads_all_problems():
    bank = load_bank()
    assert len(bank) == 420
    ts = bank["two-sum"]
    assert ts.difficulty == "Easy" and ts.topic == "Arrays & Hashing"
    assert "nc150" in ts.lists and ts.target_minutes == 15

def test_topics_ordered_with_prereqs():
    topics = load_topics()
    assert len(topics) == 18
    assert topics[0].name == "Arrays & Hashing" and topics[0].prereqs == ()
    trees = next(t for t in topics if t.name == "Trees")
    assert set(trees.prereqs) == {"Linked List", "Binary Search"}
    assert [t.order for t in topics] == sorted(t.order for t in topics)

def test_every_problem_topic_exists():
    names = {t.name for t in load_topics()}
    assert {p.topic for p in load_bank().values()} <= names
