# OpenClaw Development Guide

This document covers development setup, CLI commands, coding patterns, testing, and troubleshooting. For quick-reference rules and commands, see the main [CLAUDE.md](../CLAUDE.md).

## Prerequisites

- **Node ≥22.12.0** (required for runtime)
- **pnpm** (preferred for builds)
- **bun** (optional, for faster TypeScript execution)

## Installation

```bash
pnpm install
pnpm ui:build    # Builds the UI (auto-installs deps on first run)
pnpm build       # Builds the CLI and Gateway
```

## CLI Commands

### Development

```bash
pnpm openclaw ...           # Run CLI in dev mode (via tsx)
pnpm dev                    # Alternative dev runner
pnpm gateway:watch          # Auto-reload Gateway on TS changes
pnpm gateway:dev            # Dev Gateway (skips channels)
```

### Building

```bash
pnpm build                  # Full build: Canvas bundle, TypeScript compile, metadata
pnpm ui:build              # Build UI only
pnpm canvas:a2ui:bundle    # Bundle A2UI canvas assets
```

### Code Quality

```bash
pnpm check                 # Run all checks (tsgo + lint + format)
pnpm tsgo                  # TypeScript type checking
pnpm lint                  # Oxlint (type-aware)
pnpm lint:fix              # Auto-fix lint issues
pnpm format                # Oxfmt format check
pnpm format:fix            # Auto-fix formatting
```

### Testing

```bash
pnpm test                       # Run unit tests (Vitest)
pnpm test:coverage              # Run tests with coverage
pnpm test:e2e                   # End-to-end tests
pnpm test:live                  # Live tests (requires real API keys)
pnpm test:docker:all            # Full Docker test suite
```

### Live Testing

```bash
CLAWDBOT_LIVE_TEST=1 pnpm test:live              # Core live tests
OPENCLAW_LIVE_TEST=1 pnpm test:live              # All live tests
pnpm test:docker:live-models                      # Docker live model tests
pnpm test:docker:live-gateway                     # Docker live gateway tests
```

### macOS/iOS

```bash
pnpm mac:package               # Package macOS app
pnpm mac:restart               # Restart macOS app
pnpm ios:build                 # Build iOS app
pnpm ios:open                  # Open iOS Xcode project
```

### Android

```bash
pnpm android:assemble          # Build Android APK
pnpm android:install           # Install on device
pnpm android:run               # Build, install, and launch
```

## Development Patterns

### Dependency Injection

Use `createDefaultDeps` pattern for testable components with injectable dependencies.

### File Size Guidelines

Aim to keep files under ~500-700 LOC. Extract helpers rather than creating "V2" copies. This is a guideline, not a hard rule.

### CLI Progress

Use `src/cli/progress.ts` (`osc-progress` + `@clack/prompts` spinner). Don't hand-roll spinners/bars.

### Terminal Output

Use `src/terminal/palette.ts` for colors (Lobster seam). Keep tables ANSI-safe with `src/terminal/table.ts`.

### Testing Conventions

- Tests colocated as `*.test.ts`
- E2E tests: `*.e2e.test.ts`
- Vitest with V8 coverage (70% threshold)
- Real device preference: check for connected iOS/Android devices before using simulators

### Commits

Use `scripts/committer "<msg>" <file...>` to scope staging. Follow concise, action-oriented messages (e.g., `CLI: add verbose flag to send`).

## Documentation

Docs are hosted on Mintlify at https://docs.openclaw.ai

Internal doc links use root-relative paths without `.md` extension:

- `[Config](/configuration)` not `[Config](./configuration.md)`
- Anchors: `[Hooks](/configuration#hooks)`

When touching docs, include full URLs in your final message.

## Important Notes

- **Node baseline:** Node 22+. Keep both Node and Bun paths working.
- **Package manager:** pnpm for builds, bun optional for TS execution.
- **TypeScript:** ESM, strict mode. Prefer strict typing, avoid `any`.
- **Naming:** Use "OpenClaw" for product/docs, `openclaw` for CLI/paths/config.
- **Release channels:** stable (latest), beta (prerelease), dev (moving head).
- **Multi-agent routing:** Update all UI surfaces when adding connection providers.
- **Never edit node_modules:** Updates overwrite; skill notes go in `TOOLS.md` or `AGENTS.md`.
- **Patched dependencies:** Must use exact versions (no `^`/`~`); requires explicit approval.
- **Carbon dependency:** Never update.
- **A2UI bundle hash:** `src/canvas-host/a2ui/.bundle.hash` is auto-generated; regenerate via `pnpm canvas:a2ui:bundle`.

## Troubleshooting

- **Rebrand/migration issues:** Run `openclaw doctor`
- **Gateway not starting (macOS):** Check launchd with `launchctl print gui/$UID | grep openclaw`
- **Gateway not starting (Linux):** Check `systemctl --user status openclaw-gateway` and `journalctl --user -u openclaw-gateway`
- **Channel auth issues:** Use `openclaw login` to refresh credentials
- **Package issues:** Ensure `pnpm install` completes; some packages need native builds
- **macOS logs:** Use `./scripts/clawlog.sh` for unified logs

## Further Reading

- Gateway architecture: `docs/concepts/architecture.md`
- Gateway protocol: `docs/gateway/protocol.md`
- Agent runtime: `docs/concepts/agent.md`
- Session model: `docs/concepts/session.md`
