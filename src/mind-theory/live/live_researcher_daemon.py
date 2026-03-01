#!/usr/bin/env python3
"""
Long-running researcher daemon — called by OpenClaw's TS mind-theory module.

Stays alive across queries, eliminating Python startup + OpenAI client init overhead.
Communicates via stdin/stdout JSON-line protocol (one JSON per line).

Tracks per-session cooldowns: if the top-1 memory was injected within the last
COOLDOWN_TURNS turns, returns empty (no fall-through to #2).

Input (stdin, one JSON per line — same fields as live_researcher.py):
  {"query": "...", "agent_id": "rain", "db_path": "...", "session_key": "...", "log_path": "..."}

Output (stdout, one JSON per line):
  {"injected": [{"fact": "...", "score": 0.72}], "latency_ms": 150, "cooldown": false}

Startup signal (first stdout line):
  {"ready": true}
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

log = logging.getLogger("researcher-daemon")

COOLDOWN_TURNS = 20


# ---------------------------------------------------------------------------
# Session state: {session_key: {"turn": int, "cooldowns": {memory_id: int}}}
# ---------------------------------------------------------------------------
session_state: dict[str, dict] = {}


def get_session(session_key: str) -> dict:
    if session_key not in session_state:
        session_state[session_key] = {"turn": 0, "cooldowns": {}}
    return session_state[session_key]


def cleanup_cooldowns(state: dict) -> None:
    """Remove cooldown entries older than 2x COOLDOWN_TURNS."""
    current_turn = state["turn"]
    stale = [mid for mid, t in state["cooldowns"].items()
             if current_turn - t > COOLDOWN_TURNS * 2]
    for mid in stale:
        del state["cooldowns"][mid]


# ---------------------------------------------------------------------------
# OpenAI embedding
# ---------------------------------------------------------------------------

def load_openai_key() -> str:
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
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    )
    return response.data[0].embedding


# ---------------------------------------------------------------------------
# Per-query processing
# ---------------------------------------------------------------------------

def process_query(request: dict, oai_client: openai.OpenAI) -> dict:
    start_ms = time.monotonic()

    query = request.get("query", "")
    agent_id = request.get("agent_id", "")
    db_path = request.get("db_path", "")
    session_key = request.get("session_key", "")
    log_path = request.get("log_path", "")

    if not query or not agent_id or not db_path:
        return {"injected": [], "error": "Missing required fields", "cooldown": False}

    # Session state
    state = get_session(session_key)
    state["turn"] += 1
    current_turn = state["turn"]

    # Open DB readonly per query (~5ms, safe with concurrent Librarian writes)
    try:
        db = MemoryDB(Path(db_path), readonly=True)
    except Exception as e:
        return {"injected": [], "error": f"DB open failed: {e}", "cooldown": False}

    try:
        db_count = db.count()
        if db_count == 0:
            latency = int((time.monotonic() - start_ms) * 1000)
            return {"injected": [], "latency_ms": latency, "cooldown": False}

        # Embed query
        query_embedding = get_embedding(oai_client, query)

        # Vector-only search (no FTS5)
        scored_results = db.vector_search_scored(query_embedding, k=5, min_similarity=0.35)
        log.info("agent=%s turn=%d vec_hits=%d db_count=%d",
                 agent_id, current_turn, len(scored_results), db_count)

        # Cooldown check on top-1
        injected = []
        cooldown_hit = False
        if scored_results:
            top_mem, top_score = scored_results[0]
            last_injected_turn = state["cooldowns"].get(top_mem.id, -999)
            if current_turn - last_injected_turn < COOLDOWN_TURNS:
                cooldown_hit = True
                log.info("cooldown: memory %s injected %d turns ago (threshold=%d)",
                         top_mem.id[:12], current_turn - last_injected_turn, COOLDOWN_TURNS)
            else:
                injected.append({"fact": top_mem.fact, "score": top_score})
                state["cooldowns"][top_mem.id] = current_turn

        # Build log entry
        results_for_log = []
        for i, (m, score) in enumerate(scored_results):
            results_for_log.append({
                "id": m.id,
                "fact": m.fact,
                "context": m.context,
                "score": score,
                "importance": round(m.importance, 3),
                "tag": m.emotional_tag,
                "injected": i == 0 and not cooldown_hit,
            })

        latency = int((time.monotonic() - start_ms) * 1000)

        log_entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "session": session_key,
            "query": query[:500],
            "results": results_for_log,
            "threshold": 0.35,
            "db_count": db_count,
            "latency_ms": latency,
            "turn": current_turn,
            "cooldown": cooldown_hit,
        }

        if log_path:
            try:
                with open(log_path, "a") as f:
                    f.write(json.dumps(log_entry) + "\n")
            except Exception as e:
                log.error("Failed to write log: %s", e)

        cleanup_cooldowns(state)

        return {"injected": injected, "latency_ms": latency, "cooldown": cooldown_hit}

    finally:
        db.close()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="[researcher-daemon] %(message)s",
        stream=sys.stderr,
    )

    # Initialize OpenAI client once
    log.info("initializing OpenAI client...")
    oai_client = openai.OpenAI(api_key=load_openai_key())
    log.info("ready")

    # Signal readiness to TS
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    # Process queries from stdin (one JSON per line)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            result = {"injected": [], "error": f"Invalid JSON: {e}", "cooldown": False}
            sys.stdout.write(json.dumps(result) + "\n")
            sys.stdout.flush()
            continue

        try:
            result = process_query(request, oai_client)
        except Exception as e:
            log.error("query failed: %s", e)
            result = {"injected": [], "error": str(e), "cooldown": False}

        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()

    log.info("stdin closed, exiting")


if __name__ == "__main__":
    main()
