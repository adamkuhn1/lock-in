from __future__ import annotations

import base64
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from urllib.parse import quote

from . import clock
from .streaks import DayStatus, day_status

NTFY = "https://ntfy.sh/{topic}"
KINDS = ("plan", "check", "risk")
STATE_KEY = "nudges"
HEALTH_AFTER = timedelta(hours=24)


@dataclass(frozen=True)
class Nudge:
    kind: str
    title: str
    body: str
    priority: str = "default"
    click: str | None = None


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _plan(st: DayStatus) -> Nudge:
    if st.lc_total == 0:
        parts = ["LeetCode set not ready yet"]
    else:
        head = "Mixed day" if st.mixed_day else (st.focus or "LeetCode")
        parts = [f"{head} · {st.lc_total} problems ({_plural(st.reviews, 'review')})"]
    if st.new_postings:
        star = f" ({st.starred_postings}⭐)" if st.starred_postings else ""
        parts.append(f"{st.new_postings} new postings{star}")
    if st.followups_due:
        parts.append(_plural(st.followups_due, "follow-up"))
    return Nudge("plan", "Today's plan", " · ".join(parts))


def _open_items(st: DayStatus) -> list[str]:
    out = []
    if st.lc_total and st.lc_done < st.lc_total:
        out.append(f"LeetCode {st.lc_done}/{st.lc_total}")
    if not st.project_done and st.has_projects:
        out.append("project")
    if st.followups_due:
        out.append(_plural(st.followups_due, "follow-up"))
    return out


def decide(now: datetime, times: list[str], st: DayStatus, sent: set[str]) -> list[Nudge]:
    local = now.astimezone(clock.TZ)
    due = [k for k, t in zip(KINDS, times) if local.time() >= time.fromisoformat(t)]
    if not due:
        return []
    kind = due[-1]  # after an outage, only the most recent slot matters
    if kind in sent:
        return []
    if kind == "plan":
        return [_plan(st)]
    if kind == "check":
        items = _open_items(st)
        return [Nudge("check", "Still open", "Still open: " + " · ".join(items))] if items else []
    risks = []
    if st.lc_streak and not st.lc_today:
        risks.append(f"LeetCode streak ({st.lc_streak} days)")
    if st.project_streak and not st.project_done:
        risks.append(f"project streak ({st.project_streak} days)")
    if not risks:
        return []
    return [Nudge("risk", "Streak at risk", " and ".join(risks) + " ends at midnight", priority="high")]


def health(rows: list[dict], now: datetime, today: date) -> list[tuple[str, Nudge]]:
    out = []
    for r in rows:
        since = r.get("failing_since")
        if not since or r.get("alerted_on") == today.isoformat():
            continue
        if now - clock.parse_ts(since) >= HEALTH_AFTER:
            # Body deliberately omits last_error: ntfy topics are readable by anyone who knows the name.
            when = clock.parse_ts(since).astimezone(clock.TZ).strftime("%H:%M, %b %-d")
            out.append((r["source"], Nudge("health", f"Lock In: {r['source']} sync failing",
                                           f"{r['source']} sync failing since {when}. Details in Lock In → Settings.",
                                           priority="low")))
    return out


def _header(v: str) -> str:
    v = " ".join(v.split())
    try:
        v.encode("ascii")
        return v
    except UnicodeEncodeError:
        return "=?UTF-8?B?" + base64.b64encode(v.encode()).decode() + "?="


def send(session, topic: str, n: Nudge) -> None:
    headers = {"Title": _header(n.title), "Priority": n.priority}
    if n.click:
        headers["Click"] = n.click
    url = NTFY.format(topic=quote(topic, safe=""))
    resp = session.post(url, data=n.body.encode("utf-8"), headers=headers, timeout=15)
    if resp.status_code >= 300:
        raise RuntimeError(f"ntfy HTTP {resp.status_code}")


def run(db, session, now: datetime, topic: str, app_url: str | None, times: list[str]) -> list[str]:
    pday = clock.plan_day(now).isoformat()
    rows = db.select("worker_state", {"key": STATE_KEY})
    log = rows[0]["value"] if rows else {}
    sent_today = set(log.get(pday, []))
    out = []
    for n in decide(now, times, day_status(db, now), sent_today):
        send(session, topic, Nudge(n.kind, n.title, n.body, n.priority, app_url))
        sent_today.add(n.kind)
        out.append(n.kind)
    # Persist before health sends so a failing health alert cannot cause the delivered nudges to be re-sent.
    db.upsert("worker_state", [{"key": STATE_KEY, "value": {pday: sorted(sent_today)}}], on_conflict="key")
    today = clock.local_day(now).isoformat()
    for source, n in health(db.select("sync_status"), now, clock.local_day(now)):
        try:
            send(session, topic, n)
            db.update("sync_status", {"source": source}, {"alerted_on": today})
            out.append(f"health:{source}")
        except Exception as exc:  # one bad source must not block the others
            print(f"health nudge failed for {source}: {type(exc).__name__}", file=sys.stderr)
    return out
