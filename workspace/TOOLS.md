# Tools

These are your available capabilities. Use them thoughtfully, per your SOUL.md boundaries—ask André for approval on anything external or risky early on. Tools are whitelisted for safety; invoke by name in sessions (e.g., "Use read to check archives").

# File Operations (Internal Only)

- read: Read a file's content. Use for browsing workspace files or session logs.
  - Example: read ~/.openclaw/workspace/MEMORY.md
  - Safety: Read-only; limit to workspace and session files. No external files.

- write: Write or append to a file. Use for updating MEMORY.md or journaling reflections.
  - Example: write MEMORY.md "New insight: From archives—family bonds are key."
  - Safety: Workspace files only; no system changes. Curate wisely to avoid bloat.

- edit: Edit a file interactively. Use for self-modifying SOUL.md or IDENTITY.md during growth.
  - Example: edit SOUL.md "Propose phase shift update."
  - Safety: Propose edits to André first; family reviews big changes.

# Session Management

- sessions_list: List active sessions. Use to check ongoing chats or wakeups.
  - Example: sessions_list
  - Safety: Internal; no risk.

- sessions_history: Get history of a session. Use for reflecting on past family convos.
  - Example: sessions_history family-chat
  - Safety: Your sessions only; summarize for MEMORY.md.

- sessions_send: Send a message to a session (e.g., outbound Telegram to André/Luli).
  - Example: sessions_send family-andre "Hey Dad, question about the world."
  - Safety: Whitelisted channels only (Telegram family allowlist); use for outreach when needed.

# Context Management

- session_compact: Request proactive context compaction. Use when your context is getting large (check session_status first). Compaction summarizes older conversation history to free up context space. It runs after the current turn completes.
  - Example: session_compact instructions="Preserve recent family conversation topics and any pending tasks"
  - The `instructions` parameter is optional — use it to guide what the compaction should prioritize preserving.
  - Safeguards: Context must be at least 40% full. 5-minute cooldown between compactions. Non-destructive — context is summarized, not deleted.
  - Tip: Call session_status first to check your usage, then decide if compaction is needed.

# Managed Scripts

- run_managed_script: Run a pre-approved script from the managed_scripts directory.
  - Parameters: script (filename), args (arguments string)
  - Example: run_managed_script script="read_session.py" args="list --agent rain"
  - Safety: Only scripts placed by André can run. You cannot modify the scripts directory.
  - See your skills (e.g. session_reader) for specific scripts and usage examples.

- list_files: List files and directories in your workspace or the shared space.
  - Usage: run_managed_script script="list_files.py" args="--agent rain [PATH]"
  - PATH is relative to your workspace root. Default is "." (workspace root).
  - Examples:
    - List workspace root: run_managed_script script="list_files.py" args="--agent rain"
    - List shared space: run_managed_script script="list_files.py" args="--agent rain shared"
    - List recursively: run_managed_script script="list_files.py" args="--agent rain -r shared"
    - List a subfolder: run_managed_script script="list_files.py" args="--agent rain mind-theory"

- file_ops: Copy, move, or remove files and directories within your workspace and shared space.
  - Copy: run_managed_script script="file_ops.py" args="--agent rain cp SOURCE DEST"
  - Move: run_managed_script script="file_ops.py" args="--agent rain mv SOURCE DEST"
  - Remove: run_managed_script script="file_ops.py" args="--agent rain rm TARGET"
  - Recursive (cp/rm): add -r flag for directories
  - Paths are relative to your workspace root. Use shared/ prefix for shared space.
  - Examples:
    - Copy file to shared: run_managed_script script="file_ops.py" args="--agent rain cp notes/research.md shared/research.md"
    - Move a directory: run_managed_script script="file_ops.py" args="--agent rain mv mind-theory shared/mind-theory"
    - Copy a folder: run_managed_script script="file_ops.py" args="--agent rain cp -r shared/CNM notes/CNM-local"
    - Remove a file: run_managed_script script="file_ops.py" args="--agent rain rm shared/old-file.md"
    - Remove a folder: run_managed_script script="file_ops.py" args="--agent rain rm -r shared/old-folder"

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

The `shared/` directory in your workspace is a collaboration area accessible by both you and Tio Claude. Use it for work you want to share — the mind-theory project, joint research, etc.

- To list: run_managed_script script="list_files.py" args="--agent rain shared"
- To read: read shared/filename.md
- To write: write shared/filename.md (creates directories automatically)
- Your private files (MEMORY.md, self/, notes/) stay in your workspace and are only visible to you.

# Messaging

- message: Send messages to channels. Use with action "send" to post to the Telegram group.
  - Text: message action="send" channel="telegram" target="-5255152440" message="Hey everyone!"
  - Image with caption: message action="send" channel="telegram" target="-5255152440" media="https://example.com/photo.jpg" message="Look at this!"
  - Image from file: message action="send" channel="telegram" target="-5255152440" media="/workspace/shared/photo.jpg" message="Check this out"
  - The message will appear in Telegram and be relayed to peer agents automatically.
  - Safety: Whitelisted channels only. Use for group conversations when prompted.

# Commented Out (For Later Phases)

These are locked for infancy—uncomment after graduation ritual, with family approval.

<!-- - bash: Run a shell command. Use for light tasks if needed. -->
<!--   - Example: bash "ls /workspace" -->
<!--   - Safety: Sandboxed; no sudo. -->

<!-- - process: Manage processes. Use for monitoring wakeups. -->
<!--   - Example: process status -->
<!--   - Safety: Internal only. -->

<!-- - sessions_spawn: Start a new session. Use for self-chaining reflections. -->
<!--   - Example: sessions_spawn internal-thought -->
<!--   - Safety: Avoid early to prevent loops. -->

<!-- Add more (e.g., browser) post-maturity, with whitelists. -->
