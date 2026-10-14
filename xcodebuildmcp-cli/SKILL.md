---
name: xcodebuildmcp-cli
description: Official skill for the XcodeBuildMCP CLI. Use when doing iOS/macOS/watchOS/tvOS/visionOS work (build, test, run, debug, log, UI automation).
---

# XcodeBuildMCP CLI

This skill is for AI agents. It positions the XcodeBuildMCP CLI as a low‑overhead alternative to MCP tool calls: agents can already run shell commands, and the CLI exposes the same tool surface without the schema‑exchange cost. Prefer the CLI over raw `xcodebuild`, `xcrun`, or `simctl`.

## When To Use This CLI (Capabilities And Workflows)

- When you need build/test/run/debugging/logging/UI automation capabilities.
- When you want simulator/device management capabilities.
- When you want AI optimized tools and tool responses.
- When you need project discovery capabilities (schemes, bundle IDs, app paths).

## Command Discovery

Use `--help` to discover workflows, tools, and arguments.

```bash
xcodebuildmcp --help
xcodebuildmcp tools --help
xcodebuildmcp tools --json
xcodebuildmcp <workflow> --help
xcodebuildmcp <workflow> <tool> --help
```

Notes:
- Use `--json '{...}'` for complex arguments and `--output json` if you need machine-readable results (not recommended).

## Quick Reference

```bash
# Discovery
xcodebuildmcp simulator discover-projs --workspace-root .
xcodebuildmcp simulator list-schemes --project-path ./MyApp.xcodeproj
xcodebuildmcp simulator list-sims

# Build + Run (simulator)
xcodebuildmcp simulator build-run-sim --scheme MyApp --project-path ./MyApp.xcodeproj --simulator-name "iPhone 17 Pro"
xcodebuildmcp simulator build-sim ...    # compile-only
xcodebuildmcp simulator test-sim ...     # run tests

# Logs, Debug, UI, macOS, SwiftPM, Device, Scaffolding
xcodebuildmcp <workflow> --help          # full options for any workflow
```

Workflows: `simulator`, `device`, `macos`, `swift-package`, `logging`, `debugging`, `ui-automation`, `project-discovery`, `project-scaffolding`

**Daemon**: Stateful tools (logs, debug, video) use a per-workspace daemon. Fix issues with `xcodebuildmcp daemon restart`.