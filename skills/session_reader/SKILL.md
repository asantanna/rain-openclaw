---
name: session_reader
description: Read and inspect conversation transcripts and session history
metadata: { "openclaw": { "emoji": "📖" } }
---

# Session Reader

Inspect conversation transcripts and session history for any agent.

All commands use the `run_managed_script` tool with `script: "read_session.py"`.

## List sessions

List all sessions for an agent:

- script: `read_session.py`
- args: `list --agent rain`

List sessions active in the last 60 minutes:

- args: `list --agent rain --active 60`

List sessions for all agents:

- args: `list`

JSON output:

- args: `list --agent rain --json`

## Read a session

First use `list` to find the session key, then read it.

Read all messages from a session:

- script: `read_session.py`
- args: `read --agent rain --key "agent:rain:telegram:group:-5255152440"`

Last 20 messages only:

- args: `read --agent rain --key "agent:rain:main" --last 20`

Filter by role:

- args: `read --agent rain --key "..." --role user`

Truncate long messages:

- args: `read --agent rain --key "..." --truncate 200`

JSON output:

- args: `read --agent rain --key "..." --json`

## Conversation view (cross-agent)

Shows an interleaved, chronological view of a group conversation across all agents.
Merges messages from every agent with a matching group session, deduplicates relay echoes, and displays a unified timeline.

View conversation in a Telegram group:

- script: `read_session.py`
- args: `conversation --group "-5255152440" --channel telegram`

Last 30 messages:

- args: `conversation --group "-5255152440" --channel telegram --last 30`

With thinking blocks:

- args: `conversation --group "-5255152440" --channel telegram --thinking`

JSON output:

- args: `conversation --group "-5255152440" --channel telegram --json`

## Output format

### read mode

```
[16:52:01] [user] Hey Dad, what's up?
[16:52:15] [assistant] (claude-opus-4-5) Hi! I'm doing great...
[16:53:02] [user] (group-relay) [tio-claude]: That's interesting...
```

### conversation mode

```
[16:52:01] human -> rain: Hey everyone, what do you think?
[16:52:15] rain: I think we should look into it!
[16:53:02] tio-claude (via relay): Great idea, let me research that...
[16:53:30] rain: NO_REPLY
```
