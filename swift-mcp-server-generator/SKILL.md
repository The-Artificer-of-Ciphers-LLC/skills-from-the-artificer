---
name: swift-mcp-server-generator
description: 'Generate a complete Model Context Protocol server project in Swift using the official MCP Swift SDK package.'
---

# Swift MCP Server Generator

Generate a complete, production-ready MCP server in Swift using the official Swift SDK package.

## Generation checklist

When asked to create a Swift MCP server, work through this list and tick each item as it is done:

- [ ] Ask for the project name and a one-line description
- [ ] Generate every file in the structure below from [`references/templates.md`](references/templates.md), renaming `MyMCPServer` throughout (drop the `Resources/` or `Prompts/` group only if the user says the server does not need it)
- [ ] Shared state lives in actors; async/await throughout, no completion handlers
- [ ] swift-log logging and ServiceLifecycle graceful shutdown wired in `main.swift`
- [ ] Errors surfaced as `MCPError`; public APIs carry doc comments; Swift naming conventions (camelCase / PascalCase)
- [ ] A test per handler in `ServerTests.swift`
- [ ] `swift build` and `swift test` run clean before handing over; report their output

If the user wants something the templates do not cover, adapt the closest template rather than inventing a different project shape.

## Project structure

Generate the complete project with this layout:

```
my-mcp-server/
├── Package.swift
├── Sources/
│   └── MyMCPServer/
│       ├── main.swift
│       ├── Server.swift
│       ├── Tools/
│       │   ├── ToolDefinitions.swift
│       │   └── ToolHandlers.swift
│       ├── Resources/
│       │   ├── ResourceDefinitions.swift
│       │   └── ResourceHandlers.swift
│       └── Prompts/
│           ├── PromptDefinitions.swift
│           └── PromptHandlers.swift
├── Tests/
│   └── MyMCPServerTests/
│       └── ServerTests.swift
└── README.md
```

## Templates

Each file has a complete template in [`references/templates.md`](references/templates.md). Read only the sections you need:

| File | Section in `references/templates.md` |
|---|---|
| `Package.swift` | Package.swift Template |
| `Sources/MyMCPServer/main.swift` | main.swift Template |
| `Sources/MyMCPServer/Server.swift` | Server.swift Template |
| `Sources/MyMCPServer/Tools/ToolDefinitions.swift` | ToolDefinitions.swift Template |
| `Sources/MyMCPServer/Tools/ToolHandlers.swift` | ToolHandlers.swift Template |
| `Sources/MyMCPServer/Resources/ResourceDefinitions.swift` | ResourceDefinitions.swift Template |
| `Sources/MyMCPServer/Resources/ResourceHandlers.swift` | ResourceHandlers.swift Template |
| `Sources/MyMCPServer/Prompts/PromptDefinitions.swift` | PromptDefinitions.swift Template |
| `Sources/MyMCPServer/Prompts/PromptHandlers.swift` | PromptHandlers.swift Template |
| `Tests/MyMCPServerTests/ServerTests.swift` | ServerTests.swift Template |
| `README.md` | README.md Template |

## Build and Run

```bash
# Build
swift build

# Run
swift run

# Test
swift test

# Release build
swift build -c release

# Install
swift build -c release
cp .build/release/MyMCPServer /usr/local/bin/
```

## Integration with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-mcp-server": {
      "command": "/path/to/MyMCPServer"
    }
  }
}
```
