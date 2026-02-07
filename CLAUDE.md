# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential: Read Rain Agent Overview

**At the start of every session**, read `rain-docs/rain_overview.md`. This repository is a fork of OpenClaw customized for **Rain** — an AI agent designed as a family member (daughter) in a spherical family with André (dad) and Luli (mom). The overview covers Rain's philosophy, identity, workspace file organization, skills, deployment, and safety boundaries. All work in this repo should be informed by that context.

## Project Overview

**OpenClaw** is a personal AI assistant that runs on your own devices. It connects to multiple messaging channels (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, Matrix, and more) through a unified Gateway control plane. The system enables users to interact with AI assistants across all their communication platforms while maintaining local control and security.

Key characteristics:
- Single-user, local-first architecture
- WebSocket-based Gateway control plane (`ws://127.0.0.1:18789`)
- Pi agent runtime (RPC mode) for AI interactions
- Multi-channel messaging support (12+ built-in channels, extensible via plugins)
- Node system for mobile/desktop capabilities (iOS, Android, macOS)

## Development Setup

### Prerequisites
- **Node ≥22.12.0** (required for runtime)
- **pnpm** (preferred for builds)
- **bun** (optional, for faster TypeScript execution)

### Installation
```bash
pnpm install
pnpm ui:build    # Builds the UI (auto-installs deps on first run)
pnpm build       # Builds the CLI and Gateway
```

### Common Commands

**Development:**
```bash
pnpm openclaw ...           # Run CLI in dev mode (via tsx)
pnpm dev                    # Alternative dev runner
pnpm gateway:watch          # Auto-reload Gateway on TS changes
pnpm gateway:dev            # Dev Gateway (skips channels)
```

**Building:**
```bash
pnpm build                  # Full build: Canvas bundle, TypeScript compile, metadata
pnpm ui:build              # Build UI only
pnpm canvas:a2ui:bundle    # Bundle A2UI canvas assets
```

**Code Quality:**
```bash
pnpm check                 # Run all checks (tsgo + lint + format)
pnpm tsgo                  # TypeScript type checking
pnpm lint                  # Oxlint (type-aware)
pnpm lint:fix              # Auto-fix lint issues
pnpm format                # Oxfmt format check
pnpm format:fix            # Auto-fix formatting
```

**Testing:**
```bash
pnpm test                       # Run unit tests (Vitest)
pnpm test:coverage              # Run tests with coverage
pnpm test:e2e                   # End-to-end tests
pnpm test:live                  # Live tests (requires real API keys)
pnpm test:docker:all            # Full Docker test suite
```

**macOS/iOS:**
```bash
pnpm mac:package               # Package macOS app
pnpm mac:restart               # Restart macOS app
pnpm ios:build                 # Build iOS app
pnpm ios:open                  # Open iOS Xcode project
```

**Android:**
```bash
pnpm android:assemble          # Build Android APK
pnpm android:install           # Install on device
pnpm android:run               # Build, install, and launch
```

## Architecture Overview

### Core Components

**Gateway (src/gateway/)**
- Single long-lived daemon that owns all messaging connections
- WebSocket server on `127.0.0.1:18789` (default)
- Manages channel connections (WhatsApp/Baileys, Telegram/grammY, Slack/Bolt, Discord, etc.)
- Event-driven architecture: emits `agent`, `chat`, `presence`, `health`, `cron` events
- Protocol validation via JSON Schema (TypeBox schemas → JSON Schema → Swift models)
- Canvas host on port `18793` for agent-editable HTML/A2UI

**Agent Runtime (src/agents/)**
- Pi agent core (`@mariozechner/pi-agent-core`) in RPC mode
- Session management with isolation per channel/group
- Model failover and auth profile rotation
- Tool system: bash, browser, canvas, nodes, channels, cron
- Memory and context window management

**Channels (src/channels/, src/telegram/, src/discord/, src/slack/, etc.)**
- Abstraction layer for messaging platforms
- Built-in: WhatsApp (Baileys), Telegram (grammY), Slack (Bolt), Discord, Google Chat, Signal, iMessage
- DM pairing system for security (`dmPolicy="pairing"` by default)
- Routing and allowlist management
- Extension channels in `extensions/` (MS Teams, Matrix, Zalo, etc.)

**Nodes (src/node-host/, src/macos/)**
- WebSocket clients with `role: node`
- Device-based pairing and command exposure
- Capabilities: canvas, camera, screen recording, location, notifications
- Platforms: macOS, iOS (apps/ios/), Android (apps/android/)

**CLI (src/cli/, src/commands/)**
- TypeScript-based CLI using Commander
- Commands: gateway, agent, send, onboard, doctor, config, etc.
- Wiring in `src/cli/`, implementations in `src/commands/`

**Plugins/Extensions (extensions/)**
- Workspace packages for additional functionality
- Keep plugin-only deps in extension `package.json`
- Runtime resolves via jiti alias (`openclaw/plugin-sdk`)

### Key Subsystems

**Session Model (src/sessions/)**
- `main` session for direct chats, isolated group sessions
- Activation modes, queue modes, reply-back routing
- Session pruning and context management

**Media Pipeline (src/media/)**
- Image/audio/video processing
- Transcription hooks
- Size caps and temp file lifecycle

**Routing (src/routing/)**
- Multi-agent routing: map channels/accounts/peers to isolated agents
- Per-agent workspaces and sessions

**Security (src/security/, src/pairing/)**
- DM pairing with short codes (`dmPolicy="pairing"`)
- Device-based pairing for nodes
- Local trust model (auto-approve loopback connections)
- Gateway auth token support

**Hooks System (src/hooks/)**
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
workspace/           # Example workspace files
dist/                # Build output
```

## Important Development Patterns

### Dependency Injection
Use `createDefaultDeps` pattern for testable components with injectable dependencies.

### File Size Guidelines
Aim to keep files under ~500-700 LOC. Extract helpers rather than creating "V2" copies. This is a guideline, not a hard rule.

### CLI Progress
Use `src/cli/progress.ts` (`osc-progress` + `@clack/prompts` spinner). Don't hand-roll spinners/bars.

### Terminal Output
Use `src/terminal/palette.ts` for colors (Lobster seam). Keep tables ANSI-safe with `src/terminal/table.ts`.

### Testing
- Tests colocated as `*.test.ts`
- E2E tests: `*.e2e.test.ts`
- Vitest with V8 coverage (70% threshold)
- Real device preference: check for connected iOS/Android devices before using simulators

### Commits
Use `scripts/committer "<msg>" <file...>` to scope staging. Follow concise, action-oriented messages (e.g., `CLI: add verbose flag to send`).

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

## Multi-Agent Safety

Multiple agents can work simultaneously:
- Do NOT create/remove git worktrees or stash entries unless explicitly requested
- Do NOT switch branches unless explicitly requested
- Focus on your changes; avoid cross-cutting state changes
- When you see unrecognized files, continue and focus on your own work

## Important Notes

- **Node baseline:** Node 22+. Keep both Node and Bun paths working.
- **Package manager:** pnpm for builds, bun optional for TS execution
- **Formatting/linting:** Oxlint and Oxfmt. Run `pnpm check` before commits.
- **TypeScript:** ESM, strict mode. Prefer strict typing, avoid `any`.
- **Naming:** Use "OpenClaw" for product/docs, `openclaw` for CLI/paths/config
- **Release channels:** stable (latest), beta (prerelease), dev (moving head)
- **Gateway restart:** macOS app or `scripts/restart-mac.sh`; verify with launchctl, not ad-hoc sessions
- **macOS logs:** Use `./scripts/clawlog.sh` for unified logs
- **Multi-agent routing:** Update all UI surfaces when adding connection providers
- **Never edit node_modules:** Updates overwrite; skill notes go in `TOOLS.md` or `AGENTS.md`
- **Patched dependencies:** Must use exact versions (no `^`/`~`); requires explicit approval
- **Carbon dependency:** Never update
- **A2UI bundle hash:** `src/canvas-host/a2ui/.bundle.hash` is auto-generated; regenerate via `pnpm canvas:a2ui:bundle`

## Documentation

Docs are hosted on Mintlify at https://docs.openclaw.ai

Internal doc links use root-relative paths without `.md` extension:
- `[Config](/configuration)` not `[Config](./configuration.md)`
- Anchors: `[Hooks](/configuration#hooks)`

When touching docs, include full URLs in your final message.

## Security Defaults

- **DM policy:** `dmPolicy="pairing"` by default (users must approve via pairing codes)
- **Public inbound DMs:** Requires explicit opt-in (`dmPolicy="open"` + `"*"` in allowlist)
- **Run `openclaw doctor`** to surface risky/misconfigured policies
- **Never commit:** Real phone numbers, videos, live config values, API keys

## Testing Live Services

Live tests require real API keys:
```bash
CLAWDBOT_LIVE_TEST=1 pnpm test:live              # Core live tests
OPENCLAW_LIVE_TEST=1 pnpm test:live              # All live tests
pnpm test:docker:live-models                      # Docker live model tests
pnpm test:docker:live-gateway                     # Docker live gateway tests
```

## Troubleshooting

- **Rebrand/migration issues:** Run `openclaw doctor`
- **Mac Gateway not starting:** Check launchd with `launchctl print gui/$UID | grep openclaw`
- **Channel auth issues:** Use `openclaw login` to refresh credentials
- **Package issues:** Ensure `pnpm install` completes; some packages need native builds

For detailed architecture and protocol information, see:
- Gateway architecture: `docs/concepts/architecture.md`
- Gateway protocol: `docs/gateway/protocol.md`
- Agent runtime: `docs/concepts/agent.md`
- Session model: `docs/concepts/session.md`
