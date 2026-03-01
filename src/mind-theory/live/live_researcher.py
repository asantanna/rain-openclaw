#!/usr/bin/env python3
"""
Live researcher entry point — called by OpenClaw's TS mind-theory module.

Searches the agent's memory DB for facts relevant to the last user message.
Vector-only search (no FTS5). Returns top-1 memory for injection + logs all candidates.

Input (stdin JSON):
  {
    "query": "last user message text",
    "agent_id": "rain",
    "db_path": "/home/rain/.openclaw/agents/rain/memories.sqlite",
    "session_key": "agent:rain:telegram:...",
    "log_path": "/home/rain/.openclaw/agents/rain/researcher.log"
  }

Output (stdout JSON):
  {"injected": [{"fact": "...", "score": 0.72}], "latency_ms": 350}
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Ensure sibling modules are importable regardless of cwd
sys.path.insert(0, str(Path(__file__).parent))

import openai

from db import MemoryDB

log = logging.getLogger("live-researcher")


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


def get_embedding(client: openai.OpenAI, text: str) -> list[float]:
    """Embed text via OpenAI text-embedding-3-small."""
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return response.data[0].embedding


def main():
    start_ms = time.monotonic()

    # Setup logging to stderr (stdout reserved for JSON output)
    logging.basicConfig(
        level=logging.INFO,
        format="[researcher] %(message)s",
        stream=sys.stderr,
    )

    # Read input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    query = input_data.get("query", "")
    agent_id = input_data.get("agent_id", "")
    db_path = input_data.get("db_path", "")
    session_key = input_data.get("session_key", "")
    log_path = input_data.get("log_path", "")

    if not query or not agent_id or not db_path:
        print(json.dumps({"error": "Missing required fields: query, agent_id, db_path"}))
        sys.exit(1)

    # Open DB in readonly mode
    db = MemoryDB(Path(db_path), readonly=True)
    db_count = db.count()
    log.info("DB has %d memories", db_count)

    if db_count == 0:
        db.close()
        latency = int((time.monotonic() - start_ms) * 1000)
        print(json.dumps({"injected": [], "latency_ms": latency}))
        return

    # Embed query
    oai_client = openai.OpenAI(api_key=load_openai_key())
    query_embedding = get_embedding(oai_client, query)

    # Vector-only search (no FTS5 — it was the entire noise source on casual turns)
    scored_results = db.vector_search_scored(query_embedding, k=5, min_similarity=0.35)
    log.info("Vector search: %d hits above 0.35", len(scored_results))

    # Top-1 for injection, rest are logged only
    injected = []
    results_for_log = []
    for i, (m, score) in enumerate(scored_results):
        is_injected = i == 0  # Top-1 only
        if is_injected:
            injected.append({"fact": m.fact, "score": score})
        results_for_log.append({
            "id": m.id,
            "fact": m.fact,
            "context": m.context,
            "score": score,
            "importance": round(m.importance, 3),
            "tag": m.emotional_tag,
            "injected": is_injected,
        })

    latency = int((time.monotonic() - start_ms) * 1000)

    log_entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "session": session_key,
        "query": query[:500],  # Truncate very long messages
        "results": results_for_log,
        "threshold": 0.35,
        "db_count": db_count,
        "latency_ms": latency,
    }

    # Append JSONL to log file
    if log_path:
        try:
            with open(log_path, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
            log.info("Logged %d candidates (%d injected) to %s",
                     len(results_for_log), len(injected), log_path)
        except Exception as e:
            log.error("Failed to write log: %s", e)

    db.close()

    # Output injected memories + latency to stdout (TS parses this)
    print(json.dumps({"injected": injected, "latency_ms": latency}))


if __name__ == "__main__":
    main()
