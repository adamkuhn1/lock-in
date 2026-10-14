VENV  := $(HOME)/.lockin/venv
LABEL := com.adamkuhn.lockin.launcher
PLIST := $(HOME)/Library/LaunchAgents/$(LABEL).plist
LOG   := $(HOME)/Library/Logs/lockin-launcher.log

.PHONY: install-launcher uninstall-launcher restart-launcher keychain launcher-status

install-launcher:
	python3.12 -m venv $(VENV)
	$(VENV)/bin/pip install -q --upgrade pip
	$(VENV)/bin/pip install -q -e ./worker
	mkdir -p $(HOME)/.local/bin
	ln -sf $(VENV)/bin/lockin $(HOME)/.local/bin/lockin
	$(VENV)/bin/python -m lockin_worker.install --plist $(PLIST)
	-launchctl bootout gui/$$(id -u)/$(LABEL) 2>/dev/null
	@for i in 1 2 3 4 5 6 7 8 9 10; do launchctl print gui/$$(id -u)/$(LABEL) >/dev/null 2>&1 || break; sleep 0.5; done
	launchctl bootstrap gui/$$(id -u) $(PLIST)
	@echo "Installed. Log: $(LOG)"
	@echo "Check: $(VENV)/bin/lockin doctor"

uninstall-launcher:
	-launchctl bootout gui/$$(id -u)/$(LABEL)
	rm -f $(PLIST)

restart-launcher:
	launchctl kickstart -k gui/$$(id -u)/$(LABEL)

keychain:
	@scripts/keychain.sh

launcher-status:
	@launchctl print gui/$$(id -u)/$(LABEL) | grep -E "state|pid|last exit" || echo "not loaded"
	@tail -n 20 $(LOG) 2>/dev/null || echo "no log yet"
