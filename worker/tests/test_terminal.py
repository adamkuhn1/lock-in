import subprocess
import sys
import pytest
from lockin_worker import terminal

HOSTILE = "Job: https://x.com/j?a=1&b='q'\nSay \"hi\" — cost $5, `whoami`, $(rm -rf ~) \\n tab\there\n"


def test_write_prompt_exact_and_named(tmp_path):
    p = terminal.write_prompt(HOSTILE, "abc-123/../x", tmp_path)
    assert p.parent == tmp_path and p.name == "lockin-prompt-abc-123x.md"
    assert p.read_text(encoding="utf-8") == HOSTILE


def test_shell_command_roundtrip_hostile_prompt(tmp_path):
    cwd = tmp_path / "dir with 'quote' and $HOME"
    cwd.mkdir()
    f = terminal.write_prompt(HOSTILE, "r1", tmp_path)
    cmd = terminal.shell_command(cwd, f, program="printf %s")
    assert HOSTILE.strip() not in cmd  # the prompt never enters the command line
    out = subprocess.run(["/bin/zsh" if sys.platform == "darwin" else "/bin/sh", "-c", cmd],
                         capture_output=True, text=True, check=True).stdout
    assert out == HOSTILE.rstrip("\n")  # $(...) strips trailing newlines only


def test_shell_command_shape(tmp_path):
    cmd = terminal.shell_command(tmp_path / "a b", tmp_path / "p.md")
    assert cmd == f"cd '{tmp_path}/a b' && claude \"$(cat {tmp_path}/p.md)\""


def test_applescript_string_escapes():
    assert terminal.applescript_string('a "b" \\c') == '"a \\"b\\" \\\\c"'


@pytest.mark.skipif(sys.platform != "darwin", reason="needs osascript")
def test_applescript_string_roundtrip(tmp_path):
    cmd = terminal.shell_command(tmp_path / "it's \"x\"", tmp_path / "p.md")
    out = subprocess.run(["osascript", "-e", f"return {terminal.applescript_string(cmd)}"],
                         capture_output=True, text=True, check=True).stdout
    assert out.rstrip("\n") == cmd


def test_osascript_argv():
    argv = terminal.osascript_argv('cd /x && claude "$(cat /p)"')
    assert argv == ["osascript", "-e", 'tell application "Terminal"',
                    "-e", 'do script "cd /x && claude \\"$(cat /p)\\""',
                    "-e", "activate", "-e", "end tell"]


def test_open_in_terminal_runs_osascript(tmp_path):
    calls = []

    def run(argv, **kw):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "", "")

    f = terminal.open_in_terminal(tmp_path, "hello", "r9", run=run, directory=tmp_path)
    assert calls[0][0] == "osascript" and str(f) in calls[0][4]


def test_open_in_terminal_error(tmp_path):
    def run(argv, **kw):
        return subprocess.CompletedProcess(argv, 1, "", "execution error: Not authorized to send Apple events to Terminal. (-1743)")

    with pytest.raises(terminal.TerminalError, match="Not authorized"):
        terminal.open_in_terminal(tmp_path, "hello", "r9", run=run, directory=tmp_path)
