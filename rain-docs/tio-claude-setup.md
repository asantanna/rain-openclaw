# Tio Claude Setup Guide

Step-by-step guide to add Tio Claude as a second agent alongside Rain.

## Prerequisites

1. **Create a Telegram bot** for Tio Claude via @BotFather
   - `/newbot` → name it something like "Tio Claude" → get the bot token
   - Save the token somewhere safe

2. **Create a Telegram group**
   - Add yourself, Rain's bot, and Tio Claude's bot as members
   - Send a message in the group
   - Forward any message from the group to @userinfobot → note the group chat ID (negative number like `-100xxxxxxxxxx`)

## Config Changes (openclaw.json)

Edit `~/.openclaw/openclaw.json`. The changes below convert from single-agent/single-bot to multi-agent/multi-bot.

### Step 1: Add agents list

Add an `agents.list` array alongside the existing `agents.defaults`:

```json5
"agents": {
  "defaults": {
    // ... keep everything that's already here ...
  },
  "list": [
    {
      "id": "rain",
      "default": true,
      "workspace": "~/.openclaw/workspace"
    },
    {
      "id": "tio-claude",
      "workspace": "~/.openclaw/workspace-tio-claude"
    }
  ]
}
```

### Step 2: Convert Telegram to multi-account

Replace the current flat `channels.telegram` with a multi-account setup. Move the existing bot config under `accounts.rain`:

```json5
"channels": {
  "telegram": {
    "enabled": true,
    "accounts": {
      "rain": {
        "botToken": "<RAIN'S EXISTING BOT TOKEN>",
        "dmPolicy": "allowlist",
        "allowFrom": ["<ANDRE_ID>", "<LULI_ID>"],
        "groupPolicy": "open",
        "groups": {
          "<GROUP_CHAT_ID>": {
            "requireMention": true
          }
        },
        "streamMode": "partial"
      },
      "tio-claude": {
        "botToken": "<TIO CLAUDE BOT TOKEN>",
        "dmPolicy": "allowlist",
        "allowFrom": ["<ANDRE_ID>"],
        "groupPolicy": "open",
        "groups": {
          "<GROUP_CHAT_ID>": {
            "requireMention": true
          }
        },
        "streamMode": "partial"
      }
    }
  }
}
```

**Notes:**

- `groupPolicy: "open"` means anyone in the group can trigger a response (no sender filtering in group)
- `requireMention: true` means each bot only responds when @mentioned by name — prevents both bots from replying to every message
- Rain's `allowFrom` keeps both André and Luli for DMs; Tio Claude starts with just André

### Step 3: Add bindings

Add a top-level `bindings` array to route each Telegram account to its agent:

```json5
"bindings": [
  {
    "agentId": "rain",
    "match": { "channel": "telegram", "accountId": "rain" }
  },
  {
    "agentId": "tio-claude",
    "match": { "channel": "telegram", "accountId": "tio-claude" }
  }
]
```

## Deploy Workspace

```bash
# Deploy Tio Claude's workspace files
./deploy_tio_claude.sh

# Copy auth profile from Rain's agent (shares Anthropic API key)
mkdir -p ~/.openclaw/agents/tio-claude/agent
cp ~/.openclaw/agents/main/agent/auth-profiles.json ~/.openclaw/agents/tio-claude/agent/auth-profiles.json
```

**Note:** Rain's agent directory is `agents/main/` (the implicit default). Tio Claude's will be `agents/tio-claude/`. The auth-profiles.json has the Anthropic API key — both agents need it to call Claude.

## Restart and Test

```bash
# Restart the gateway to pick up all changes
systemctl --user restart openclaw-gateway

# Check logs
journalctl --user -u openclaw-gateway -f
```

### Test in Telegram

1. DM Rain's bot → should work as before
2. DM Tio Claude's bot → should respond as Tio Claude
3. In the group: type `@rain_bot_username hello` → only Rain responds
4. In the group: type `@tio_claude_bot_username hello` → only Tio Claude responds
5. In the group: type a message without @mention → neither responds (requireMention is on)

## Placeholder Values to Replace

| Placeholder                   | Where to find it                                      |
| ----------------------------- | ----------------------------------------------------- |
| `<RAIN'S EXISTING BOT TOKEN>` | Current `channels.telegram.botToken` in openclaw.json |
| `<TIO CLAUDE BOT TOKEN>`      | From @BotFather when you create the new bot           |
| `<ANDRE_ID>`                  | First number in tmpkeys/telegram_ids.txt              |
| `<LULI_ID>`                   | Second number in tmpkeys/telegram_ids.txt             |
| `<GROUP_CHAT_ID>`             | From @userinfobot after creating the group            |
