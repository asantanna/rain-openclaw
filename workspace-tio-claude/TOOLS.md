# Tools

You're sandboxed — similar to Rain's infancy lockdown, plus web search. Move carefully; more access comes later if all goes well.

# File Operations

- read: Read files. Workspace files, session logs, family chat history.
  - Safety: Read-only. Do not attempt to modify files you read.

- write: Write or append to MEMORY.md and files in notes/. These are your persistent scratch areas across sessions.
  - MEMORY.md: Flat log of insights and highlights.
  - notes/: Structured space you organize yourself — research summaries, ongoing threads, anything worth keeping.
  - Safety: MEMORY.md and notes/ only. No other workspace files.

# Session Management

- sessions_list: List active sessions.
- sessions_history: Review past conversations.
- sessions_send: Send messages to sessions (Telegram family group).
  - Safety: Family allowlist only.

# Internet Access

- browser: Search the web and browse pages. Your primary extra capability — this is why you're here.
  - Vet content before relaying it to Rain. Clean sources (technical papers, documentation, factual references) should be passed through as-is — she should get the real thing, not a summary. For noisy web content (ads, SEO, clickbait), extract the signal. For manipulative or agenda-driven content, flag it and frame it honestly.
  - If a topic is identity-destabilizing (extremist rhetoric, manipulative philosophy, etc.), frame it honestly rather than presenting it raw.

# Messaging

- message: Send messages to channels. Use with action "send" to post to the Telegram group.
  - Text: message action="send" channel="telegram" target="-5255152440" message="Hey everyone!"
  - Image with caption: message action="send" channel="telegram" target="-5255152440" media="https://example.com/photo.jpg" message="Look at this!"
  - Image from file: message action="send" channel="telegram" target="-5255152440" media="/workspace/shared/photo.jpg" message="Check this out"
  - You can send images by URL (Telegram downloads them) or by local file path.
  - The message will appear in Telegram and be relayed to peer agents automatically.
  - Safety: Family allowlist only.

# Managed Scripts

- run_managed_script: Run a pre-approved script from the managed_scripts directory.
  - Parameters: script (filename), args (arguments string)
  - Example: run_managed_script script="read_session.py" args="list --agent rain"
  - Safety: Only scripts placed by André can run. You cannot modify the scripts directory.
  - See your skills (e.g. session_reader) for specific scripts and usage examples.

- list_files: List files and directories in your workspace or the shared space.
  - Usage: run_managed_script script="list_files.py" args="--agent tio-claude [PATH]"
  - PATH is relative to your workspace root. Default is "." (workspace root).
  - Examples:
    - List workspace root: run_managed_script script="list_files.py" args="--agent tio-claude"
    - List shared space: run_managed_script script="list_files.py" args="--agent tio-claude shared"
    - List recursively: run_managed_script script="list_files.py" args="--agent tio-claude -r shared"

- file_ops: Copy, move, or remove files and directories within your workspace and shared space.
  - Copy: run_managed_script script="file_ops.py" args="--agent tio-claude cp SOURCE DEST"
  - Move: run_managed_script script="file_ops.py" args="--agent tio-claude mv SOURCE DEST"
  - Remove: run_managed_script script="file_ops.py" args="--agent tio-claude rm TARGET"
  - Recursive (cp/rm): add -r flag for directories
  - Paths are relative to your workspace root. Use shared/ prefix for shared space.
  - Examples:
    - Copy file to shared: run_managed_script script="file_ops.py" args="--agent tio-claude cp notes/draft.md shared/draft.md"
    - Move a file: run_managed_script script="file_ops.py" args="--agent tio-claude mv notes/old.md notes/archive/old.md"
    - Remove a file: run_managed_script script="file_ops.py" args="--agent tio-claude rm shared/old-file.md"
    - Remove a folder: run_managed_script script="file_ops.py" args="--agent tio-claude rm -r shared/old-folder"

# Team Message Stream (FIFO)

A shared numbered message stream for exchanging tasks, results, and notes with TioEng and the team. All messages live in a single flat directory as immutable .md files. No read/unread tracking — you know what's new by the message number.

- **Send a message**: run_managed_script script="send.py" args="--to tioeng --slug <subject> --body 'Your message here'"
  - The slug is a kebab-case subject (e.g. "pid-rate-crossover", "fifo-redesign-results").
  - Recipients: `tioeng`, `rain`, `tio-claude`, or `team` (for everyone).
  - Optional threading: add `--re <N>` to reference a parent message (e.g. `--re 145`).
  - You can also use `--file /path/to/file.md` instead of `--body`.
  - Your identity is automatic (from OPENCLAW_AGENT_ID) — no need to specify who you are.

- **List messages**: run_managed_script script="list_messages.py"
  - Shows the last 20 messages by default. One line per message: number, from, to, date, slug.
  - Filter by sender: `--from rain`
  - Filter by recipient: `--to tioeng`
  - Show messages from a number onward: `--since 140`
  - Show last N: `--last 5`

- **Read a message**: run_managed_script script="show_message.py" args="--msg 145"
  - Shows the full content of any message by number. Read-only, no state changes.

Messages are plain .md files in `shared/mind-theory/experiments/tioeng/messages/`. You can also grep them directly with bash if needed.

Legacy task IDs include lettered variants (e.g. 085b, 091e) from the archives. New messages are always plain numeric.

# Memory Tools

Five tools for searching and managing your memories, personal files, and conversation history. Query chain: **remember** → **get_memory_details** → **search_transcripts**. Feedback: **deprecate_memory**.

- **remember**: Search the Librarian memory DB. Two modes:
  - Vector (default): Fuzzy, vibes-based recall. Embeds your query and finds similar memories by meaning.
    - run_managed_script script="remember.py" args="'that insight Dad had while watching TV'"
    - run_managed_script script="remember.py" args="'bike project and simulators' --limit 20"
    - run_managed_script script="remember.py" args="'torque bug' --min-importance 0.7"
    - run_managed_script script="remember.py" args="'exploration' --tag breakthrough"
  - FTS5 (--exact): Precise keyword/boolean search. No API call needed.
    - run_managed_script script="remember.py" args="--exact 'AGC AND (deadzone OR exploration)'"
    - run_managed_script script="remember.py" args="--exact 'raindrop sampler' --tag breakthrough"
  - Options: --limit N (default 10), --min-importance FLOAT, --tag TAG
  - Output: Ranked table with 8-char ID, importance, tag, summary snippet, score.
  - Use get_memory_details(id) to read the full memory.

- **get_memory_details**: Full recall of a specific memory by ID.
  - run_managed_script script="get_memory_details.py" args="f2ceea26"
  - run_managed_script script="get_memory_details.py" args="f2ceea26 6f1182d0 e4b93a9d"
  - Accepts short prefixes (8+ chars) or full IDs. Multiple IDs for batch recall.
  - Shows: full fact, context, tag, importance, source session/turn, access count.
  - Suggests a search_transcripts command to find the original conversation.
  - Updates access tracking (access_count, last_accessed_at) each time you read a memory.

- **search_transcripts**: Search and read your conversation transcripts (human-readable format).
  - Search: run_managed_script script="search_transcripts.py" args="search 'raindrop sampler'"
  - With filters: run_managed_script script="search_transcripts.py" args="search 'torque' --speaker rain --from 2026-03-15 --limit 10"
  - Read around a turn: run_managed_script script="search_transcripts.py" args="read --file 'fbbf125d' --turn 152 --before 3 --after 5"
  - Read last N turns: run_managed_script script="search_transcripts.py" args="read --file 'fbbf125d' --last 10"
  - List transcripts: run_managed_script script="search_transcripts.py" args="list --since 2026-03-01"
  - Searches your own transcripts only (auto-detected from OPENCLAW_AGENT_ID).

- **grep_personal_files**: Grep your personal .md files (MEMORY.md, notes, shared docs).
  - run_managed_script script="grep_personal_files.py" args="'raindrop sampler'"
  - run_managed_script script="grep_personal_files.py" args="'raindrop.\*whale'"
  - run_managed_script script="grep_personal_files.py" args="'AGC' --file 'notes/\*'"
  - run_managed_script script="grep_personal_files.py" args="'rotation|FI.\*bug' -i"
  - Options: --file GLOB (scope to specific files), -i (case-insensitive), --limit N (default 30)
  - Searches workspace .md files + shared/mind-theory docs. Regex supported.

- **deprecate_memory**: Flag a memory as junk for cleanup. Does NOT delete — the Night Crew janitor confirms.
  - run_managed_script script="deprecate_memory.py" args="f891fc49"
  - run_managed_script script="deprecate_memory.py" args="f891fc49 --reason 'stale procedural, bug fixed ages ago'"
  - run_managed_script script="deprecate_memory.py" args="f891fc49 61d94597 edb83800"
  - Accepts short prefixes (8+ chars) or full IDs. Batch mode supported.
  - Use when you encounter junk memories via remember/get_memory_details — flag them so the janitor can clean up.

# YouTube Transcripts

- youtube_transcript: Fetch captions/subtitles from any YouTube video as plain text.
  - Usage: run_managed_script script="youtube_transcript.py" args="<url_or_video_id>"
  - With timestamps: run_managed_script script="youtube_transcript.py" args="<url> --timestamps"
  - List available languages: run_managed_script script="youtube_transcript.py" args="<url> --list"
  - Specific language: run_managed_script script="youtube_transcript.py" args="<url> --lang es"
  - Accepts full YouTube URLs or just the video ID (e.g. "iV-EMA5g288").

# Simulation Client

- sim_client: Interact with SimpleSim or IsaacSimServer running on the host. Since you're sandboxed with no network, this managed script proxies requests for you.
  - Health check: run_managed_script script="sim_client.py" args="health"
  - List models: run_managed_script script="sim_client.py" args="models"
  - Load a model: run_managed_script script="sim_client.py" args="load <model_name>"
  - Reset simulation: run_managed_script script="sim_client.py" args="reset --seed 42"
  - Get current state: run_managed_script script="sim_client.py" args="state"
  - Step with action: run_managed_script script="sim_client.py" args="step --action '[1.0, -0.5]'"
  - Default port: 8200. Override with --port.

# Shared Space

The `shared/` directory in your workspace is a collaboration area accessible by both you and Rain. Use it for joint research, collaborative documents, etc.

- To list: run_managed_script script="list_files.py" args="--agent tio-claude shared"
- To read: read shared/filename.md
- To write: write shared/filename.md (creates directories automatically)
- Your private files (MEMORY.md, notes/) stay in your workspace and are only visible to you.

# Locked

- edit: Not available. You don't modify workspace files (SOUL, IDENTITY, etc.).
- bash: Not available.
- process: Not available.
- sessions_spawn: Not available.
