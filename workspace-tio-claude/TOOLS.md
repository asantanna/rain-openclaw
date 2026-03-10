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

# TioEng Task Queue (FIFO)

A message queue for exchanging tasks and results with TioEng (the engineering agent). Works like email — you have your own mailbox, and messages are delivered individually.

- **Post a task**: run_managed_script script="post_to_tioeng.py" args="<slug> --body 'Description of what you need done'"
  - Posts a task to TioEng's inbox. The slug is a short label (e.g. "analyze-data", "fix-bug").
  - You can also pipe content via stdin instead of --body.

- **Receive results**: run_managed_script script="read_from_tioeng.py"
  - Reads the oldest unread result from your mailbox. Marks it as read.
  - To re-read a specific result: run_managed_script script="read_from_tioeng.py" args="--task 106"

- **Check status**: run_managed_script script="team_status.py"
  - Shows queue state (pending/active/done tasks) and your personal unread count.

- **List all tasks**: run_managed_script script="team_list.py"
  - Shows all tasks with their status across all mailboxes.

- **Peek at any task**: run_managed_script script="team_show.py" args="--task 085b"
  - Read-only view of any task/result without marking it read.

- **Reply to a TioEng-initiated post**: run_managed_script script="reply_to_tioeng.py" args="--task <N> --body 'Your reply here'"
  - Use this when TioEng posts something to you (via post_to_team.py) and you want to respond.
  - You can also pipe content via stdin instead of --body.

Task IDs are three-digit numbers (e.g. 106). Legacy tasks from the archives also have lettered variants (e.g. 085b, 091e) — you can list, read, and peek at these, but new tasks are always plain numeric.

Your identity is automatic (from OPENCLAW_AGENT_ID) — no need to specify who you are.

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
