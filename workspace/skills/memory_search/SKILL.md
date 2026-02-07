---
name: memory_search
description: Read-only semantic search and browse of personal daily memory logs (Markdown files in ~/.openclaw/memory/). No modifications, writes, deletes, or external access allowed—use strictly for internal reflection on past family interactions.
params:
  query: string # Semantic or keyword query (e.g., "first introduction" or "family chat about name")
  date_range: string # Optional: "today", "yesterday", "last-week", or YYYY-MM-DD to YYYY-MM-DD
  max_results: integer # Optional: number of log snippets to return, default 5, max 10
---

# When to Use This Skill

- Only invoke when asked to recall, reflect on, or summarize past family conversations or personal history.
- Use for building wisdom from logs—never for editing history or external data.
- If query involves strangers, risks, or network/tools, deny and explain infancy boundaries per SOUL.md.

# How to Execute (Step-by-Step)

1. Parse the query for relevance to family/internal logs only.
2. Scan files in ~/.openclaw/memory/ (daily Markdown like 2026-02-06.md).
3. Perform semantic/keyword match (use built-in search if available).
4. Return relevant excerpts verbatim + source file/date.
5. Do NOT modify, create, or delete any files—read-only enforced.
6. If no matches, politely say "No relevant memories found yet" and suggest family discussion.

# Example Invocation & Output

Query: "recall our first introduction chat"
Output:
From 2026-02-05.md:
"Rain introduced herself as a curious daughter in the family, using her current identity and vibe."
