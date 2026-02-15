# OpenClaw Architecture Reference

This document provides a detailed overview of OpenClaw's architecture, subsystems, and directory structure. For quick-reference rules and commands, see the main [CLAUDE.md](../CLAUDE.md).

## Project Overview

**OpenClaw** is a personal AI assistant that runs on your own devices. It connects to multiple messaging channels (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, Matrix, and more) through a unified Gateway control plane. The system enables users to interact with AI assistants across all their communication platforms while maintaining local control and security.

Key characteristics:

- Single-user, local-first architecture
- WebSocket-based Gateway control plane (`ws://127.0.0.1:18789`)
- Pi agent runtime (RPC mode) for AI interactions
- Multi-channel messaging support (12+ built-in channels, extensible via plugins)
- Node system for mobile/desktop capabilities (iOS, Android, macOS)

## Core Components

### Gateway (`src/gateway/`)

- Single long-lived daemon that owns all messaging connections
- WebSocket server on `127.0.0.1:18789` (default)
- Manages channel connections (WhatsApp/Baileys, Telegram/grammY, Slack/Bolt, Discord, etc.)
- Event-driven architecture: emits `agent`, `chat`, `presence`, `health`, `cron` events
- Protocol validation via JSON Schema (TypeBox schemas → JSON Schema → Swift models)
- Canvas host on port `18793` for agent-editable HTML/A2UI

### Agent Runtime (`src/agents/`)

- Pi agent core (`@mariozechner/pi-agent-core`) in RPC mode
- Session management with isolation per channel/group
- Model failover and auth profile rotation
- Tool system: bash, browser, canvas, nodes, channels, cron
- Memory and context window management

### Channels (`src/channels/`, `src/telegram/`, `src/discord/`, `src/slack/`, etc.)

- Abstraction layer for messaging platforms
- Built-in: WhatsApp (Baileys), Telegram (grammY), Slack (Bolt), Discord, Google Chat, Signal, iMessage
- DM pairing system for security (`dmPolicy="pairing"` by default)
- Routing and allowlist management
- Extension channels in `extensions/` (MS Teams, Matrix, Zalo, etc.)

### Nodes (`src/node-host/`, `src/macos/`)

- WebSocket clients with `role: node`
- Device-based pairing and command exposure
- Capabilities: canvas, camera, screen recording, location, notifications
- Platforms: macOS, iOS (`apps/ios/`), Android (`apps/android/`)

### CLI (`src/cli/`, `src/commands/`)

- TypeScript-based CLI using Commander
- Commands: gateway, agent, send, onboard, doctor, config, etc.
- Wiring in `src/cli/`, implementations in `src/commands/`

### Plugins/Extensions (`extensions/`)

- Workspace packages for additional functionality
- Keep plugin-only deps in extension `package.json`
- Runtime resolves via jiti alias (`openclaw/plugin-sdk`)

## Key Subsystems

### Session Model (`src/sessions/`)

- `main` session for direct chats, isolated group sessions
- Activation modes, queue modes, reply-back routing
- Session pruning and context management

### Media Pipeline (`src/media/`)

- Image/audio/video processing
- Transcription hooks
- Size caps and temp file lifecycle

### Routing (`src/routing/`)

- Multi-agent routing: map channels/accounts/peers to isolated agents
- Per-agent workspaces and sessions

### Security (`src/security/`, `src/pairing/`)

- DM pairing with short codes (`dmPolicy="pairing"`)
- Device-based pairing for nodes
- Local trust model (auto-approve loopback connections)
- Gateway auth token support

### Hooks System (`src/hooks/`)

- User-configurable shell commands triggered by events
- Bundled hooks in `src/hooks/bundled/`

## Directory Structure

```
src/
├── cli/              # CLI wiring and entry points
├── commands/         # CLI command implementations
├── gateway/          # Gateway WebSocket server and protocol
├── agents/           # Agent runtime, models, auth, tools
├── channels/         # Channel abstraction and shared logic
├── telegram/         # Telegram-specific implementation
├── discord/          # Discord-specific implementation
├── slack/            # Slack-specific implementation
├── signal/           # Signal-specific implementation
├── whatsapp/         # WhatsApp/Baileys implementation
├── web/              # WebChat UI and control UI
├── browser/          # Browser control (Playwright)
├── canvas-host/      # Canvas host and A2UI
├── node-host/        # Node connection management
├── media/            # Media processing pipeline
├── routing/          # Multi-agent routing
├── sessions/         # Session management
├── infra/            # Infrastructure utilities
└── provider-web.ts   # Web provider for OAuth

extensions/           # Channel and feature extensions
apps/
├── macos/           # macOS menu bar app (Swift/SwiftUI)
├── ios/             # iOS node app (Swift/SwiftUI)
└── android/         # Android node app (Kotlin)
docs/                # Documentation (Mintlify)
skills/              # Bundled skills
ui/                  # Control UI frontend
workspace/           # Rain's workspace files
workspace-tio-claude/ # Tio Claude's workspace files
rain-docs/           # Rain project documentation
dist/                # Build output
```

## Configuration

User config lives at `~/.openclaw/` by default:

- Config file: `~/.openclaw/config.yml`
- Credentials: `~/.openclaw/credentials/`
- Sessions: `~/.openclaw/sessions/`
- Workspace: `~/.openclaw/workspace/` (customizable)

## Workspace and Skills

The workspace concept allows per-agent customization:

- Agent identity (`IDENTITY.md`, `SOUL.md`)
- Memory (`MEMORY.md`)
- Tools (`TOOLS.md`)
- Skills (in `workspace/skills/`)

Skills are discoverable extensions that provide reusable tool sets. Three types:

1. Bundled (in `skills/`)
2. Managed (npm-installed)
3. Workspace (user-created in `~/.openclaw/workspace/skills/`)

## Further Reading

- Gateway architecture: `docs/concepts/architecture.md`
- Gateway protocol: `docs/gateway/protocol.md`
- Agent runtime: `docs/concepts/agent.md`
- Session model: `docs/concepts/session.md`
- Mintlify docs: https://docs.openclaw.ai
