#!/usr/bin/env python3
"""Read and inspect OpenClaw conversation transcripts and session history."""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

AGENTS_DIR = Path(os.environ.get("OPENCLAW_AGENTS_DIR", Path.home() / ".openclaw" / "agents"))


def discover_agents() -> list[str]:
    """List agent IDs from the agents directory."""
    if not AGENTS_DIR.is_dir():
        return []
    return sorted(
        d.name
        for d in AGENTS_DIR.iterdir()
        if d.is_dir() and (d / "sessions").is_dir()
    )


def load_sessions_store(agent_id: str) -> dict:
    """Read sessions.json for an agent."""
    path = AGENTS_DIR / agent_id / "sessions" / "sessions.json"
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


def find_session_file(agent_id: str, session_key: str) -> Path | None:
    """Resolve a session key to its JSONL transcript path."""
    store = load_sessions_store(agent_id)
    entry = store.get(session_key)
    if not entry:
        return None
    session_id = entry.get("sessionId")
    if not session_id:
        return None
    # Check explicit sessionFile first, then default path
    explicit = entry.get("sessionFile")
    if explicit:
        p = Path(explicit)
        if p.exists():
            return p
    default = AGENTS_DIR / agent_id / "sessions" / f"{session_id}.jsonl"
    return default if default.exists() else None


def parse_messages(jsonl_path: Path, include_thinking: bool = False) -> list[dict]:
    """Read JSONL transcript and yield parsed messages."""
    messages = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") != "message":
                continue
            msg = obj.get("message", {})
            role = msg.get("role")
            if not role:
                continue
            # Extract text from content blocks
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
                        elif block.get("type") == "thinking" and include_thinking:
                            parts.append(f"[thinking] {block.get('thinking', '')}")
                text = "\n".join(parts)
            else:
                text = str(content)
            # Timestamp
            ts = obj.get("timestamp") or msg.get("timestamp")
            if isinstance(ts, (int, float)):
                dt = datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts, tz=timezone.utc)
            elif isinstance(ts, str):
                try:
                    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except ValueError:
                    dt = None
            else:
                dt = None
            messages.append({
                "role": role,
                "model": msg.get("model"),
                "text": text,
                "timestamp": dt,
                "stop_reason": msg.get("stopReason"),
            })
    return messages


def format_time(dt: datetime | None) -> str:
    """Format datetime as local time string."""
    if dt is None:
        return "??:??:??"
    local = dt.astimezone()
    return local.strftime("%H:%M:%S")


def format_age(updated_at: int | None) -> str:
    """Format millisecond timestamp as relative age."""
    if not updated_at:
        return "?"
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    diff_min = (now_ms - updated_at) / 60000
    if diff_min < 1:
        return "<1m"
    if diff_min < 60:
        return f"{int(diff_min)}m"
    if diff_min < 1440:
        return f"{diff_min / 60:.1f}h"
    return f"{diff_min / 1440:.1f}d"


# ── list ─────────────────────────────────────────────────────────────────────

def cmd_list(args: argparse.Namespace) -> None:
    agents = [args.agent] if args.agent else discover_agents()
    if not agents:
        print("No agents found.", file=sys.stderr)
        sys.exit(1)

    rows: list[tuple] = []
    for agent_id in agents:
        store = load_sessions_store(agent_id)
        for key, entry in store.items():
            updated = entry.get("updatedAt")
            if args.active:
                if not updated:
                    continue
                now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
                if (now_ms - updated) > args.active * 60 * 1000:
                    continue
            rows.append((
                agent_id,
                key,
                format_age(updated),
                entry.get("channel", ""),
                entry.get("chatType", ""),
                entry.get("displayName") or entry.get("origin", {}).get("label", ""),
            ))

    # Sort by agent, then key
    rows.sort(key=lambda r: (r[0], r[1]))

    if args.json:
        print(json.dumps([
            {"agent": r[0], "key": r[1], "age": r[2], "channel": r[3],
             "chatType": r[4], "displayName": r[5]}
            for r in rows
        ], indent=2))
        return

    if not rows:
        print("No sessions found.")
        return

    # Calculate column widths
    headers = ("AGENT", "KEY", "AGE", "CHANNEL", "TYPE", "DISPLAY NAME")
    widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            widths[i] = max(widths[i], len(str(val)))
    # Cap key width at 60
    widths[1] = min(widths[1], 60)

    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*("-" * w for w in widths)))
    for row in rows:
        display = list(row)
        if len(display[1]) > 60:
            display[1] = display[1][:57] + "..."
        print(fmt.format(*display))


# ── read ─────────────────────────────────────────────────────────────────────

def cmd_read(args: argparse.Namespace) -> None:
    jsonl_path = find_session_file(args.agent, args.key)
    if not jsonl_path:
        print(f"Session not found: agent={args.agent} key={args.key}", file=sys.stderr)
        sys.exit(1)

    messages = parse_messages(jsonl_path, include_thinking=args.thinking)

    # Apply filters
    if args.role:
        messages = [m for m in messages if m["role"] == args.role]
    if args.model:
        messages = [m for m in messages if m["model"] == args.model]
    if args.last:
        messages = messages[-args.last:]

    if args.json:
        print(json.dumps([
            {"time": format_time(m["timestamp"]), "role": m["role"],
             "model": m["model"], "text": m["text"][:500],
             "stop_reason": m["stop_reason"]}
            for m in messages
        ], indent=2))
        return

    for m in messages:
        time_str = format_time(m["timestamp"])
        role = m["role"]
        model_tag = f" ({m['model']})" if m["model"] else ""
        text = m["text"]
        if args.truncate and len(text) > args.truncate:
            text = text[:args.truncate] + "..."
        print(f"[{time_str}] [{role}]{model_tag} {text}")
        if args.separator:
            print()


# ── conversation ─────────────────────────────────────────────────────────────

def cmd_conversation(args: argparse.Namespace) -> None:
    """Cross-agent interleaved group conversation view."""
    agents = discover_agents()
    if not agents:
        print("No agents found.", file=sys.stderr)
        sys.exit(1)

    # Build the session key suffix to match
    channel = args.channel
    group_id = args.group
    key_suffix = f":{channel}:group:{group_id}"

    all_messages: list[dict] = []

    for agent_id in agents:
        store = load_sessions_store(agent_id)
        for key, entry in store.items():
            if not key.endswith(key_suffix):
                continue
            jsonl_path = find_session_file(agent_id, key)
            if not jsonl_path:
                continue
            messages = parse_messages(jsonl_path, include_thinking=args.thinking)
            for m in messages:
                m["agent"] = agent_id
                # For user messages with group-relay model, extract sender
                if m["role"] == "user" and m["model"] == "group-relay":
                    text = m["text"]
                    if text.startswith("[") and "]:" in text:
                        sender_end = text.index("]:")
                        m["relay_sender"] = text[1:sender_end]
                        m["text"] = text[sender_end + 2:].strip()
                    elif text.startswith("[from: ") and "]" in text:
                        end = text.index("]")
                        m["relay_sender"] = text[7:end]
                        m["text"] = text[end + 1:].strip()
            all_messages.extend(messages)

    # Sort by timestamp
    all_messages.sort(key=lambda m: m["timestamp"] or datetime.min.replace(tzinfo=timezone.utc))

    # Deduplicate: the same human message arrives to each agent, and relay echoes
    # appear in multiple transcripts. Dedup by timestamp + role + normalized text.
    seen: set[str] = set()
    deduped: list[dict] = []
    for m in all_messages:
        # Round to nearest second for dedup (same message reaches agents ms apart)
        ts_key = m["timestamp"].replace(microsecond=0).isoformat() if m["timestamp"] else "none"
        text = m["text"] or ""
        # Strip Telegram envelope prefix for dedup (varies per agent due to relative time)
        # e.g. "[Telegram Rain Tech Group id:-5255152440 +3m 2026-02-10 17:04 PST] Name (id): ..."
        clean = re.sub(r"^\[.*?\]\s*", "", text) if m["role"] == "user" and not m.get("relay_sender") else text
        dedup_key = f"{ts_key}|{m['role']}|{clean[:80]}"

        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        # Skip delivery-mirror entries (these are echoes)
        if m["model"] == "delivery-mirror":
            continue

        deduped.append(m)

    if args.last:
        deduped = deduped[-args.last:]

    if args.json:
        print(json.dumps([
            {"time": format_time(m["timestamp"]), "agent": m["agent"],
             "role": m["role"], "model": m.get("model"),
             "relay_sender": m.get("relay_sender"),
             "text": m["text"][:500]}
            for m in deduped
        ], indent=2))
        return

    if not deduped:
        print("No messages found.")
        return

    for m in deduped:
        time_str = format_time(m["timestamp"])
        agent = m["agent"]
        role = m["role"]
        text = m["text"]
        if args.truncate and len(text) > args.truncate:
            text = text[:args.truncate] + "..."

        if role == "assistant":
            # Agent's own response
            print(f"[{time_str}] {agent}: {text}")
        elif role == "user":
            if m.get("relay_sender"):
                # Relayed message from another agent
                print(f"[{time_str}] {m['relay_sender']} (via relay): {text}")
            elif m.get("model") == "group-relay":
                # Relay message without parsed sender
                print(f"[{time_str}] relay -> {agent}: {text}")
            else:
                # Human message
                origin = m.get("origin_label", "human")
                print(f"[{time_str}] human -> {agent}: {text}")

        if args.separator:
            print()


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read and inspect OpenClaw conversation transcripts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # list
    p_list = sub.add_parser("list", help="List sessions for an agent")
    p_list.add_argument("--agent", "-a", help="Agent ID (omit to list all agents)")
    p_list.add_argument("--active", type=int, metavar="MIN",
                        help="Only show sessions active in the last N minutes")
    p_list.add_argument("--json", action="store_true", help="Output as JSON")
    p_list.set_defaults(func=cmd_list)

    # read
    p_read = sub.add_parser("read", help="Read messages from a session")
    p_read.add_argument("--agent", "-a", required=True, help="Agent ID")
    p_read.add_argument("--key", "-k", required=True, help="Session key")
    p_read.add_argument("--last", "-n", type=int, help="Show only last N messages")
    p_read.add_argument("--role", choices=["user", "assistant"], help="Filter by role")
    p_read.add_argument("--model", help="Filter by model (e.g. group-relay, claude-opus-4-5)")
    p_read.add_argument("--thinking", action="store_true", help="Include thinking blocks")
    p_read.add_argument("--truncate", "-t", type=int, default=0,
                        help="Truncate message text to N chars (0=no limit)")
    p_read.add_argument("--separator", "-s", action="store_true",
                        help="Add blank line between messages")
    p_read.add_argument("--json", action="store_true", help="Output as JSON")
    p_read.set_defaults(func=cmd_read)

    # conversation
    p_conv = sub.add_parser("conversation",
                            help="Interleaved cross-agent group conversation view")
    p_conv.add_argument("--group", "-g", required=True, help="Group/peer ID")
    p_conv.add_argument("--channel", "-c", required=True, help="Channel (e.g. telegram)")
    p_conv.add_argument("--last", "-n", type=int, help="Show only last N messages")
    p_conv.add_argument("--thinking", action="store_true", help="Include thinking blocks")
    p_conv.add_argument("--truncate", "-t", type=int, default=0,
                        help="Truncate message text to N chars (0=no limit)")
    p_conv.add_argument("--separator", "-s", action="store_true",
                        help="Add blank line between messages")
    p_conv.add_argument("--json", action="store_true", help="Output as JSON")
    p_conv.set_defaults(func=cmd_conversation)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
