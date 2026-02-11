---
name: session_reader
description: Read and inspect conversation transcripts and session history
metadata: { "openclaw": { "emoji": "📖" } }
---

# Session Reader

Inspect conversation transcripts and session history for any agent.

## Usage

All commands use the Python script at `{baseDir}/scripts/read_session.py`.

### List sessions

```bash
# List all sessions for an agent
python3 {baseDir}/scripts/read_session.py list --agent rain

# List sessions active in the last 60 minutes
python3 {baseDir}/scripts/read_session.py list --agent rain --active 60

# List sessions for all agents
python3 {baseDir}/scripts/read_session.py list

# JSON output
python3 {baseDir}/scripts/read_session.py list --agent rain --json
```

### Read a session

```bash
# Read all messages from a session
python3 {baseDir}/scripts/read_session.py read --agent rain --key "agent:rain:telegram:group:-5255152440"

# Last 20 messages only
python3 {baseDir}/scripts/read_session.py read --agent rain --key "agent:rain:main" --last 20

# Filter by role
python3 {baseDir}/scripts/read_session.py read --agent rain --key "..." --role user

# Filter by model (e.g. group-relay messages only)
python3 {baseDir}/scripts/read_session.py read --agent rain --key "..." --model group-relay

# Truncate long messages
python3 {baseDir}/scripts/read_session.py read --agent rain --key "..." --truncate 200

# JSON output
python3 {baseDir}/scripts/read_session.py read --agent rain --key "..." --json
```

### Conversation view (cross-agent)

Shows an interleaved, chronological view of a group conversation across all agents.
This merges messages from every agent that has a session for the same group, deduplicates
relay echoes, and displays a unified timeline.

```bash
# View conversation in a Telegram group
python3 {baseDir}/scripts/read_session.py conversation --group "-5255152440" --channel telegram

# Last 30 messages
python3 {baseDir}/scripts/read_session.py conversation --group "-5255152440" --channel telegram --last 30

# With thinking blocks included
python3 {baseDir}/scripts/read_session.py conversation --group "-5255152440" --channel telegram --thinking

# JSON output
python3 {baseDir}/scripts/read_session.py conversation --group "-5255152440" --channel telegram --json
```

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

## Notes

- Uses only Python stdlib (no pip dependencies)
- Session files are at `~/.openclaw/agents/{agentId}/sessions/`
- Override the agents directory with `OPENCLAW_AGENTS_DIR` env var
