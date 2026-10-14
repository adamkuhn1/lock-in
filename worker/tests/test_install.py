import plistlib
import subprocess
from pathlib import Path
from lockin_worker import install

REPO = Path(__file__).resolve().parents[2]


def test_plist_dict():
    d = install.plist_dict("/Users/a/.lockin/venv/bin/python", Path("/Users/a"))
    assert d["Label"] == "com.adamkuhn.lockin.launcher"
    assert d["ProgramArguments"] == ["/Users/a/.lockin/venv/bin/python", "-m", "lockin_worker.launcher"]
    assert d["RunAtLoad"] is True and d["KeepAlive"] is True
    assert d["StandardOutPath"] == d["StandardErrorPath"] == "/Users/a/Library/Logs/lockin-launcher.log"
    assert d["EnvironmentVariables"]["PYTHONUNBUFFERED"] == "1"
    assert "/usr/bin" in d["EnvironmentVariables"]["PATH"]


def test_write_plist_is_valid(tmp_path):
    p = tmp_path / "LaunchAgents" / "x.plist"
    install.write_plist(p, "/py", Path("/Users/a"))
    assert plistlib.loads(p.read_bytes())["Label"] == install.LABEL


def test_keychain_script_syntax_and_no_echo():
    script = (REPO / "scripts" / "keychain.sh").read_text()
    subprocess.run(["bash", "-n", str(REPO / "scripts" / "keychain.sh")], check=True)
    assert "set -x" not in script and 'echo "$value"' not in script
    for acct in ("supabase_url", "service_key", "owner_id"):
        assert f"store {acct} " in script


def test_makefile_targets_use_tabs():
    mk = (REPO / "Makefile").read_text()
    for target in ("install-launcher:", "uninstall-launcher:", "keychain:", "launcher-status:"):
        assert target in mk
    assert "\n\tlaunchctl bootstrap gui/$$(id -u) $(PLIST)" in mk
    assert "restart-launcher:" in mk
    assert "\n\tlaunchctl kickstart -k gui/$$(id -u)/$(LABEL)" in mk
    boot, bootstrap = mk.index("-launchctl bootout"), mk.index("launchctl bootstrap")
    assert "launchctl print gui/$$(id -u)/$(LABEL)" in mk[boot:bootstrap]  # waits for bootout to finish


def test_keychain_script_never_puts_secrets_in_argv():
    sh = (REPO / "scripts" / "keychain.sh").read_text()
    assert "read -r -s" not in sh and "$value" not in sh
    cmds = [l for l in sh.splitlines() if "add-generic-password" in l]
    assert len(cmds) == 1 and cmds[0].rstrip().endswith(" -w")
