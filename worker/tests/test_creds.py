import subprocess
import pytest
from lockin_worker import creds


class Run:
    def __init__(self, values):
        self.values, self.calls = values, []

    def __call__(self, argv, **kw):
        self.calls.append(argv)
        acct = argv[argv.index("-a") + 1]
        v = self.values.get(acct)
        return subprocess.CompletedProcess(argv, 0 if v else 44, stdout=(v or "") + "\n", stderr="")


def test_keychain_argv_and_strip():
    run = Run({"service_key": "sk-123"})
    assert creds.keychain_get("service_key", run) == "sk-123"
    assert run.calls[0] == ["security", "find-generic-password", "-s", "lockin", "-a", "service_key", "-w"]


def test_env_override_skips_keychain():
    run = Run({})
    assert creds.get("owner_id", {"LOCKIN_OWNER_ID": "u-1"}, run) == "u-1"
    assert run.calls == []


def test_missing_item_error_is_helpful_and_secret_free():
    with pytest.raises(creds.CredsError, match="make keychain") as e:
        creds.get("service_key", {}, Run({}))
    assert "lockin/service_key" in str(e.value)


def test_make_db_uses_all_three():
    run = Run({"supabase_url": "https://p.supabase.co", "service_key": "k", "owner_id": "o"})
    db = creds.make_db({}, run)
    assert (db.base, db.key, db.owner) == ("https://p.supabase.co/rest/v1/", "k", "o")


def test_values_are_stripped():
    assert creds.get("owner_id", {"LOCKIN_OWNER_ID": "  u-1\n"}, Run({})) == "u-1"
    assert creds.get("owner_id", {"LOCKIN_OWNER_ID": " \n"}, Run({"owner_id": " k2 "})) == "k2"


def _fake(rc, stdout="", stderr="", exc=None):
    seen = {}

    def run(argv, **kw):
        seen.update(kw)
        if exc:
            raise exc
        return subprocess.CompletedProcess(argv, rc, stdout=stdout, stderr=stderr)
    run.seen = seen
    return run


def test_keychain_get_passes_timeout():
    run = _fake(0, "v\n")
    assert creds.keychain_get("owner_id", run) == "v"
    assert run.seen["timeout"] == 20


def test_keychain_timeout_is_locked_message():
    run = _fake(0, exc=subprocess.TimeoutExpired(["security"], 20, output=b"SECRET", stderr=b"SECRET"))
    with pytest.raises(creds.CredsError) as e:
        creds.keychain_get("service_key", run)
    msg = str(e.value)
    assert "lockin/service_key" in msg and "locked or unreadable" in msg and "unlock your login keychain" in msg
    assert "SECRET" not in msg


def test_keychain_rc44_is_missing():
    with pytest.raises(creds.CredsError) as e:
        creds.keychain_get("service_key", _fake(44, "", "SECRET"))
    assert "missing" in str(e.value) and "make keychain" in str(e.value) and "SECRET" not in str(e.value)


def test_keychain_other_rc_is_locked_and_secret_free():
    with pytest.raises(creds.CredsError) as e:
        creds.keychain_get("service_key", _fake(51, "SECRET", "SECRET"))
    msg = str(e.value)
    assert "locked or unreadable" in msg and "rc=51" in msg and "SECRET" not in msg
