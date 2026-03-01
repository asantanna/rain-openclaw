#!/usr/bin/env -S python3 -u
"""
Live session watcher — tails a conversation with evoked memory display.

Usage:
  python3 watch_session.py rain                         # auto-find latest active session
  python3 watch_session.py rain --researcher            # also show researcher log (scores, cooldowns)
  python3 watch_session.py rain -k agent:rain:telegram:...  # specific session
  python3 watch_session.py rain --history 20            # show last 20 messages for context
  python3 watch_session.py rain --no-history            # skip history, live only
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

AGENTS_DIR = Path.home() / ".openclaw" / "agents"

# ANSI colors
DIM = "\033[2m"
RESET = "\033[0m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"
RED = "\033[31m"


# ---------------------------------------------------------------------------
# Session discovery
# ---------------------------------------------------------------------------

def find_latest_session(agent_id: str) -> tuple[str | None, Path | None]:
    """Find the most recently updated session file for an agent."""
    sessions_json = AGENTS_DIR / agent_id / "sessions" / "sessions.json"
    if not sessions_json.exists():
        return None, None

    with open(sessions_json) as f:
        store = json.load(f)

    latest_key = None
    latest_time = 0
    for key, entry in store.items():
        updated = entry.get("updatedAt", 0)
        if updated > latest_time:
            latest_time = updated
            latest_key = key

    if not latest_key:
        return None, None

    return latest_key, resolve_session_file(agent_id, store[latest_key])


def resolve_session_file(agent_id: str, entry: dict) -> Path | None:
    session_id = entry.get("sessionId")
    if not session_id:
        return None
    explicit = entry.get("sessionFile")
    if explicit and Path(explicit).exists():
        return Path(explicit)
    default = AGENTS_DIR / agent_id / "sessions" / f"{session_id}.jsonl"
    return default if default.exists() else None


def find_session_by_key(agent_id: str, key: str) -> Path | None:
    sessions_json = AGENTS_DIR / agent_id / "sessions" / "sessions.json"
    if not sessions_json.exists():
        return None
    with open(sessions_json) as f:
        store = json.load(f)
    entry = store.get(key)
    if not entry:
        return None
    return resolve_session_file(agent_id, entry)


# ---------------------------------------------------------------------------
# Message parsing
# ---------------------------------------------------------------------------

def parse_message(line: str) -> dict | None:
    """Parse a JSONL line into a display message."""
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None

    if obj.get("type") != "message":
        return None

    msg = obj.get("message", {})
    role = msg.get("role")
    if not role:
        return None

    content = msg.get("content", [])
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
        text = "\n".join(parts)
    else:
        text = str(content)

    # Extract and remove evoked memories block
    evoked = None
    evoked_match = re.search(
        r"### EVOKED MEMORIES\n([\s\S]*?)### END EVOKED MEMORIES", text
    )
    if evoked_match:
        evoked = evoked_match.group(1).strip()
        text = re.sub(
            r"### EVOKED MEMORIES\n[\s\S]*?### END EVOKED MEMORIES\n*", "", text
        ).strip()

    ts = obj.get("timestamp") or msg.get("timestamp")
    dt = _parse_ts(ts)

    return {
        "role": role,
        "text": text,
        "evoked": evoked,
        "timestamp": dt,
        "model": msg.get("model"),
    }


def _parse_ts(ts) -> datetime | None:
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(
            ts / 1000 if ts > 1e12 else ts, tz=timezone.utc
        )
    if isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def format_time(dt: datetime | None) -> str:
    if dt is None:
        return "??:??:??"
    return dt.astimezone().strftime("%H:%M:%S")


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

def clean_user_text(text: str) -> tuple[str, str]:
    """Strip inbound metadata, return (sender_label, clean_text)."""
    # Remove untrusted metadata blocks
    text = re.sub(
        r"(?:^|\n\n?)[\w\s]+\(untrusted[\w\s,]*\):\n```json\n[\s\S]*?```",
        "",
        text,
    )
    text = text.strip()

    # Check for relay sender prefix [Name]:
    sender_match = re.match(r"^\[([^\]]+)\]:\s*", text)
    if sender_match:
        return sender_match.group(1), text[sender_match.end() :]

    return "User", text


def _indent_continuation(text: str, indent: str = "           ") -> str:
    """Indent continuation lines of multiline text."""
    lines = text.split("\n")
    if len(lines) <= 1:
        return text
    return lines[0] + "\n" + "\n".join(indent + l for l in lines[1:])


def display_message(msg: dict, agent_id: str, truncate: int = 0) -> str | None:
    """Display a message. Returns role for turn-spacing, or None if skipped."""
    time_str = format_time(msg["timestamp"])
    role = msg["role"]
    text = msg["text"]

    if role == "user":
        sender, text = clean_user_text(text)
        text = text.strip()
        if not text:
            return None
        if truncate and len(text) > truncate:
            text = text[:truncate] + "..."
        text = _indent_continuation(text)
        color = CYAN if sender != "User" else YELLOW
        print(f"{DIM}[{time_str}]{RESET} {color}{sender}{RESET}: {text}")

        # Show evoked memories from the message itself
        if msg.get("evoked"):
            for eline in msg["evoked"].split("\n"):
                eline = eline.strip()
                if eline:
                    print(f"           {MAGENTA}🧠 {eline}{RESET}")
        return role

    elif role == "assistant":
        text = text.strip()
        # Skip empty messages and NO_REPLY
        if not text or text == "NO_REPLY":
            return None
        label = agent_id.capitalize()
        if truncate and len(text) > truncate:
            text = text[:truncate] + "..."
        text = _indent_continuation(text)
        print(f"{DIM}[{time_str}]{RESET} {GREEN}{label}{RESET}: {text}")
        return role

    return None


def display_researcher(entry: dict, session_key: str | None) -> None:
    """Display a researcher log entry (filtered by session if specified)."""
    if session_key and entry.get("session") != session_key:
        return

    turn = entry.get("turn", "?")
    cooldown = entry.get("cooldown", False)
    latency = entry.get("latency_ms", "?")
    results = entry.get("results", [])

    if cooldown:
        query = entry.get("query", "")
        if query:
            if len(query) > 90:
                query = query[:90] + "..."
            print(f"           {DIM}▸ \"{query}\"{RESET}")
        top = results[0] if results else {}
        fact = top.get("fact", "?")
        if len(fact) > 70:
            fact = fact[:70] + "..."
        print(
            f"           {YELLOW}🧠 COOLDOWN{RESET} {DIM}turn={turn} lat={latency}ms{RESET}"
            f" {DIM}(top: {fact}){RESET}"
        )
    elif results:
        injected = [r for r in results if r.get("injected")]
        if injected:
            # Show what triggered the memory
            query = entry.get("query", "")
            if query:
                if len(query) > 90:
                    query = query[:90] + "..."
                print(f"           {DIM}▸ \"{query}\"{RESET}")
            for r in injected:
                score = r.get("score", "?")
                fact = r.get("fact", "?")
                if len(fact) > 80:
                    fact = fact[:80] + "..."
                print(
                    f"           {MAGENTA}🧠 EVOKED{RESET}"
                    f" {DIM}score={score} turn={turn} lat={latency}ms{RESET}"
                    f"\n           {MAGENTA}{fact}{RESET}"
                )
        else:
            # No results above threshold
            if int(latency) if isinstance(latency, int) else False:
                print(
                    f"           {DIM}🧠 no match turn={turn} lat={latency}ms{RESET}"
                )


# ---------------------------------------------------------------------------
# Tail loop
# ---------------------------------------------------------------------------

def _load_researcher_entries(researcher_path: Path, session_key: str | None) -> list[tuple[datetime, dict]]:
    """Load researcher log entries, return [(timestamp, entry)] filtered by session."""
    entries = []
    if not researcher_path.exists():
        return entries
    with open(researcher_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if session_key and entry.get("session") != session_key:
                continue
            ts = _parse_ts(entry.get("ts"))
            if ts:
                entries.append((ts, entry))
    return entries


def _read_new_lines(path: Path, pos: int) -> tuple[list[str], int]:
    """Read new lines from a file starting at pos. Returns (lines, new_pos)."""
    if not path.exists():
        return [], pos
    try:
        current = path.stat().st_size
    except FileNotFoundError:
        return [], pos
    if current <= pos:
        return [], pos
    with open(path) as f:
        f.seek(pos)
        data = f.read()
        new_pos = f.tell()
    lines = [l for l in data.strip().split("\n") if l.strip()]
    return lines, new_pos


def tail_files(
    session_path: Path,
    researcher_path: Path,
    agent_id: str,
    session_key: str | None,
    history: int = 10,
    truncate: int = 0,
    show_researcher: bool = False,
) -> None:
    """Tail session JSONL and (optionally) researcher log, interleaved by timestamp."""

    # --- History: merge both streams chronologically ---
    if history > 0 and session_path.exists():
        # Load session messages
        with open(session_path) as f:
            lines = f.readlines()
        all_msgs = []
        for line in lines:
            msg = parse_message(line)
            if msg and msg["timestamp"]:
                all_msgs.append(msg)

        if all_msgs:
            show_msgs = all_msgs[-history:]
            earliest = show_msgs[0]["timestamp"]

            # Build merged timeline: ("msg", ts, data) or ("researcher", ts, data)
            timeline = []
            for msg in show_msgs:
                timeline.append(("msg", msg["timestamp"], msg))

            if show_researcher:
                researcher_entries = _load_researcher_entries(researcher_path, session_key)
                relevant = [(ts, e) for ts, e in researcher_entries if ts >= earliest]
                for ts, entry in relevant:
                    timeline.append(("researcher", ts, entry))

            timeline.sort(key=lambda x: x[1])

            print(f"{DIM}--- last {len(show_msgs)} of {len(all_msgs)} messages ---{RESET}")
            last_role = None
            for kind, _ts, data in timeline:
                if kind == "msg":
                    role = data.get("role")
                    if last_role and role != last_role:
                        print()  # blank line between turn changes
                    shown = display_message(data, agent_id, truncate)
                    if shown:
                        last_role = shown
                else:
                    display_researcher(data, session_key)
            print(f"\n{DIM}--- live ---{RESET}")
            print()

    # Seek to end of both files
    session_pos = session_path.stat().st_size if session_path.exists() else 0
    researcher_pos = researcher_path.stat().st_size if researcher_path.exists() else 0

    last_role = None
    try:
        while True:
            events = []

            # Collect new researcher entries (only if opted in)
            if show_researcher:
                new_rlines, researcher_pos = _read_new_lines(researcher_path, researcher_pos)
                for rline in new_rlines:
                    try:
                        entry = json.loads(rline)
                        if session_key and entry.get("session") != session_key:
                            continue
                        ts = _parse_ts(entry.get("ts")) or datetime.now(timezone.utc)
                        events.append(("researcher", ts, entry))
                    except json.JSONDecodeError:
                        pass

            # Collect new session messages
            new_slines, session_pos = _read_new_lines(session_path, session_pos)
            for sline in new_slines:
                msg = parse_message(sline)
                if msg:
                    ts = msg["timestamp"] or datetime.now(timezone.utc)
                    events.append(("msg", ts, msg))

            if events:
                events.sort(key=lambda x: x[1])
                for kind, _ts, data in events:
                    if kind == "msg":
                        role = data.get("role")
                        if last_role and role != last_role:
                            print()
                        shown = display_message(data, agent_id, truncate)
                        if shown:
                            last_role = shown
                    else:
                        display_researcher(data, session_key)
            else:
                time.sleep(0.3)

    except KeyboardInterrupt:
        print(f"\n{DIM}--- stopped ---{RESET}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Live session watcher with evoked memory display.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  %(prog)s rain                         # watch Rain's latest session
  %(prog)s rain --researcher            # also show researcher log (scores, cooldowns)
  %(prog)s tio-claude                   # watch Tio's latest session
  %(prog)s rain -k agent:rain:telegram:dm:123  # specific session
  %(prog)s rain --history 20            # show last 20 messages
  %(prog)s rain --no-history            # live only, no backlog
  %(prog)s rain -t 200                  # truncate long messages
  %(prog)s rain --full                  # no truncation
""",
    )
    parser.add_argument("agent", help="Agent ID (e.g. rain, tio-claude)")
    parser.add_argument(
        "-k", "--key", help="Session key (default: most recently active)"
    )
    parser.add_argument(
        "--history",
        type=int,
        default=10,
        help="Number of recent messages to show on start (default: 10)",
    )
    parser.add_argument(
        "--no-history",
        action="store_true",
        help="Skip history, show only new messages",
    )
    parser.add_argument(
        "-t",
        "--truncate",
        type=int,
        default=500,
        help="Truncate messages to N chars (0=no limit, default: 500)",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Show full messages (no truncation)",
    )
    parser.add_argument(
        "--researcher",
        action="store_true",
        help="Show researcher log (scores, cooldowns, queries)",
    )

    args = parser.parse_args()
    agent_id = args.agent
    history = 0 if args.no_history else args.history
    if args.full:
        args.truncate = 0

    # Resolve session
    if args.key:
        session_key = args.key
        session_path = find_session_by_key(agent_id, session_key)
        if not session_path:
            print(f"Session not found: {agent_id} / {session_key}", file=sys.stderr)
            sys.exit(1)
    else:
        session_key, session_path = find_latest_session(agent_id)
        if not session_path:
            print(f"No active session found for {agent_id}", file=sys.stderr)
            sys.exit(1)

    researcher_path = AGENTS_DIR / agent_id / "researcher.log"

    print(f"{DIM}Watching: {agent_id}{RESET}")
    print(f"{DIM}Session:  {session_key}{RESET}")
    print(f"{DIM}File:     {session_path}{RESET}")
    print(f"{DIM}Ctrl+C to stop{RESET}")
    print()

    tail_files(session_path, researcher_path, agent_id, session_key, history, args.truncate, args.researcher)


if __name__ == "__main__":
    main()
