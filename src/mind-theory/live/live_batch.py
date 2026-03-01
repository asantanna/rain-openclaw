#!/usr/bin/env python3
"""
Live batch entry point — called by OpenClaw's TS mind-theory module at compaction time.

Reads JSON from stdin, processes new messages through the batch Librarian,
stores memories in the agent's DB, and outputs results to stdout.

Input (stdin JSON):
  {
    "messages": [{"role": "user"|"assistant", "content": "..."}],
    "session_key": "session-id",
    "agent_id": "rain",
    "agent_name": "Rain",
    "db_path": "/home/rain/.openclaw/agents/rain/memories.sqlite",
    "model": "claude-sonnet-4-6",
    "name_mapping": {"handle": "name"}
  }

Output (stdout JSON):
  {"stored": N, "total_memories": N, "watermark": N}
"""

import json
import logging
import os
import sys
from pathlib import Path

# Ensure sibling modules are importable regardless of cwd
sys.path.insert(0, str(Path(__file__).parent))

import anthropic
import openai

from db import MemoryDB
from librarian import Librarian, LibrarianConfig
from transcript import Turn

log = logging.getLogger("live-batch")


def make_embed_fn(oai_client: openai.OpenAI):
    """Return a caching embedding function using OpenAI."""
    cache: dict[str, list[float]] = {}

    def embed(text: str) -> list[float]:
        if text in cache:
            return cache[text]
        response = oai_client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )
        vec = response.data[0].embedding
        cache[text] = vec
        return vec

    return embed


def messages_to_turns(messages: list[dict]) -> list[Turn]:
    """
    Convert raw message array (role + content pairs) into Turn objects.
    Groups user→assistant pairs, same logic as transcript.py but from live messages.
    """
    turns = []
    turn_num = 0
    i = 0

    # Extract text from content (may be string or content blocks array)
    def extract_text(content) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "text":
                        parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        parts.append(f"[tool: {block.get('name', '?')}]")
            return "\n".join(parts)
        return ""

    while i < len(messages):
        msg = messages[i]
        if msg.get("role") != "user":
            i += 1
            continue

        user_text = extract_text(msg.get("content", ""))
        i += 1

        # Collect assistant messages until next user message
        assistant_parts = []
        while i < len(messages) and messages[i].get("role") == "assistant":
            assistant_parts.append(extract_text(messages[i].get("content", "")))
            i += 1

        if assistant_parts:
            turn_num += 1
            assistant_text = "\n".join(assistant_parts)
            # Skip very short turns
            if len(user_text) > 20 or len(assistant_text) > 20:
                turns.append(Turn(
                    number=turn_num,
                    user_text=user_text,
                    assistant_text=assistant_text,
                    timestamp="",
                ))

    return turns


def load_openai_key() -> str:
    """Load OpenAI API key for embeddings."""
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key
    config_path = Path.home() / ".openclaw" / "openclaw.json"
    if config_path.exists():
        with open(config_path) as f:
            config = json.load(f)
        key = (config.get("agents", {}).get("defaults", {})
               .get("memorySearch", {}).get("remote", {}).get("apiKey", ""))
        if key:
            return key
    raise RuntimeError("No OpenAI API key found")


def load_anthropic_key(agent_id: str) -> str:
    """Load Anthropic API key."""
    key_file = Path.home() / ".openclaw" / ".anthropic-key"
    if key_file.exists():
        key = key_file.read_text().strip()
        if key:
            return key
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key
    auth_path = Path.home() / ".openclaw" / "agents" / agent_id / "agent" / "auth-profiles.json"
    if auth_path.exists():
        with open(auth_path) as f:
            store = json.load(f)
        token = store.get("profiles", {}).get("anthropic:default", {}).get("token", "")
        if token:
            return token
    raise RuntimeError(f"No Anthropic API key found for agent '{agent_id}'")


def main():
    # Setup logging to stderr (stdout reserved for JSON output)
    logging.basicConfig(
        level=logging.INFO,
        format="[mind-theory] %(message)s",
        stream=sys.stderr,
    )

    # Read input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    messages = input_data.get("messages", [])
    session_key = input_data.get("session_key", "")
    agent_id = input_data.get("agent_id", "")
    agent_name = input_data.get("agent_name", "")
    db_path = input_data.get("db_path", "")
    model = input_data.get("model", "claude-sonnet-4-6")
    name_mapping = input_data.get("name_mapping", {})

    if not messages or not session_key or not agent_id or not db_path:
        print(json.dumps({"error": "Missing required fields: messages, session_key, agent_id, db_path"}))
        sys.exit(1)

    # Convert messages to turns
    all_turns = messages_to_turns(messages)
    log.info("Converted %d messages to %d turns", len(messages), len(all_turns))

    if not all_turns:
        print(json.dumps({"stored": 0, "total_memories": 0, "watermark": 0}))
        return

    # Open DB
    db = MemoryDB(Path(db_path))

    # Read watermark from meta table
    watermark_key = f"watermark:{session_key}"
    row = db.conn.execute(
        "SELECT value FROM meta WHERE key = ?", (watermark_key,)
    ).fetchone()
    watermark = int(row[0]) if row else 0
    log.info("Watermark for %s: %d", session_key, watermark)

    # Filter turns by watermark (turn numbers > watermark)
    new_turns = [t for t in all_turns if t.number > watermark]
    log.info("New turns to process: %d (of %d total)", len(new_turns), len(all_turns))

    if not new_turns:
        total = db.count()
        db.close()
        print(json.dumps({"stored": 0, "total_memories": total, "watermark": watermark}))
        return

    # Load API clients
    anthropic_key = load_anthropic_key(agent_id)
    openai_key = load_openai_key()
    anth_client = anthropic.Anthropic(api_key=anthropic_key)
    oai_client = openai.OpenAI(api_key=openai_key)
    embed_fn = make_embed_fn(oai_client)

    # Policy file
    policy_path = Path(db_path).parent / "librarian-policy.md"
    if not policy_path.exists():
        policy_path.write_text("# Librarian Policy\n\n(No rules yet — learning from scratch)\n")

    # Initialize Librarian
    librarian = Librarian(
        config=LibrarianConfig(
            agent_id=agent_id,
            agent_name=agent_name,
            model=model,
            policy_path=str(policy_path),
            name_mapping=name_mapping,
        ),
        db=db,
        embed_fn=embed_fn,
        client=anth_client,
    )

    # Process batch
    stored = librarian.process_batch(new_turns, session_key)
    log.info("Stored %d memories from %d turns", len(stored), len(new_turns))

    # Update watermark to the highest turn number processed
    new_watermark = max(t.number for t in new_turns)
    db.conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
        (watermark_key, str(new_watermark)),
    )
    db.conn.commit()

    total = db.count()
    db.close()

    # Output result to stdout
    print(json.dumps({
        "stored": len(stored),
        "total_memories": total,
        "watermark": new_watermark,
    }))


if __name__ == "__main__":
    main()
