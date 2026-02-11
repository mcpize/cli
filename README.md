# mcpize

Deploy and monetize MCP servers in the cloud.

## Installation

```bash
npm install -g mcpize
```

## Quick Start

```bash
# Login to MCPize
mcpize login

# Create a new MCP server
mcpize init my-server

# Deploy to the cloud
cd my-server
mcpize deploy

# Or analyze an existing project
cd existing-mcp-server
mcpize analyze
mcpize deploy
```

## Authentication

```bash
# Browser login (recommended) - opens mcpize.com
mcpize login

# Email/password login
mcpize login --email
```

Browser login opens mcpize.com, you sign in with Google/GitHub/email, and the CLI receives your session automatically.

## Commands

| Command | Description |
|---------|-------------|
| `mcpize login` | Authenticate via browser (recommended) |
| `mcpize login --email` | Authenticate with email/password |
| `mcpize logout` | Log out from MCPize |
| `mcpize init [name]` | Create a new MCP server project |
| `mcpize analyze` | Generate mcpize.yaml from existing project |
| `mcpize link` | Link current directory to an existing server |
| `mcpize deploy` | Deploy to MCPize Cloud |
| `mcpize status` | Show server status and deployments |
| `mcpize logs` | View runtime and build logs |
| `mcpize secrets list` | List environment secrets |
| `mcpize secrets set <name>` | Set a secret |
| `mcpize secrets delete <name>` | Delete a secret (alias: `rm`) |
| `mcpize doctor` | Run pre-deploy diagnostics |
| `mcpize whoami` | Show current authenticated user |
| `mcpize dev` | Run local dev server with hot reload |

## Local Development

Run your MCP server locally with hot reload:

```bash
# Start local dev server
mcpize dev

# With custom entry point
mcpize dev src/server.ts

# Expose via public tunnel (for testing with Claude/clients)
mcpize dev --tunnel

# Open MCPize Playground for interactive testing
mcpize dev --playground

# Choose tunnel provider (localtunnel, ngrok, cloudflared)
mcpize dev --tunnel --provider ngrok
```

The `--playground` flag automatically creates a tunnel and opens the [MCPize Playground](https://mcpize.com/playground) where you can test your server's tools interactively.

## Templates

Create a new project from a template:

```bash
# TypeScript (default)
mcpize init my-server

# Generate from OpenAPI spec
mcpize init my-api --template openapi --from-url https://api.example.com/openapi.json

# Python
mcpize init my-server --template python
```

## Analyze

Generate `mcpize.yaml` from an existing MCP server project:

```bash
# Analyze current directory
mcpize analyze

# Preview without saving
mcpize analyze --dry-run

# Overwrite existing mcpize.yaml
mcpize analyze --force

# Skip confirmation prompt
mcpize analyze --yes
```

The analyze command:
- Detects runtime (TypeScript, Python, Container)
- Extracts start command from package.json/Dockerfile
- Identifies required credentials from code
- Generates a ready-to-deploy manifest

## Secrets Management

```bash
# Set a secret
mcpize secrets set API_KEY sk-xxx

# Set from file
mcpize secrets set CREDENTIALS --from-file ./credentials.json

# List secrets (names only)
mcpize secrets list

# Export secrets
mcpize secrets export --format env
```

## Logs

```bash
# View runtime logs
mcpize logs

# View build logs
mcpize logs --type build

# Follow logs in real-time
mcpize logs --follow

# Filter by severity
mcpize logs --severity ERROR
```

## Linking

```bash
# Link current directory to an existing server
mcpize link

# Link to a specific server
mcpize link --server <server-id>

# Force re-link
mcpize link --force
```

## Options

```bash
# Use specific server
mcpize status --server <server-id>

# Output as JSON
mcpize status --json

# Deploy without waiting
mcpize deploy --no-wait

# Auto-create server if not linked
mcpize deploy --yes

# Force refresh (ignore cache)
mcpize status --refresh
```

## Global Options

| Option | Description |
|--------|-------------|
| `--token <token>` | API token (overrides `MCPIZE_TOKEN` env and saved session) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MCPIZE_TOKEN` | API token (alternative to `mcpize login`) |

## mcpize.yaml Reference

The `mcpize.yaml` file configures your MCP server deployment:

```yaml
version: 1
name: my-server
description: My MCP server
runtime: typescript  # typescript, python, php, container
entry: src/index.ts

build:
  install: npm ci
  command: npm run build
  # dockerfile: Dockerfile  # for container runtime

startCommand:
  type: http  # http, sse, stdio
  command: node dist/index.js
  # args: ["--port", "8080"]

# For STDIO servers (auto-bridged to HTTP)
# bridge:
#   mode: stdio

# Publisher secrets (infrastructure credentials)
secrets:
  - name: OPENAI_API_KEY
    required: true
    description: OpenAI API key

# Subscriber credentials (per-user API keys)
# credentials:
#   - name: USER_TOKEN
#     required: true
#     docs_url: https://example.com/docs
#     mapping:
#       env: API_TOKEN
# credentials_mode: per_user
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Yes | Schema version (always `1`) |
| `runtime` | Yes | `typescript`, `python`, `php`, or `container` |
| `entry` | No | Entry point file |
| `build.install` | No | Install command (e.g., `npm ci`) |
| `build.command` | No | Build command (e.g., `npm run build`) |
| `startCommand.type` | No | Transport: `http`, `sse`, or `stdio` |
| `startCommand.command` | No | Start command |
| `bridge.mode` | No | STDIO bridging mode (auto-wraps with mcp-proxy) |
| `secrets` | No | Publisher infrastructure secrets |
| `credentials` | No | Subscriber BYOK credentials |

## IDE Autocomplete

Add this to `.vscode/settings.json` for mcpize.yaml autocomplete:

```json
{
  "yaml.schemas": {
    "https://raw.githubusercontent.com/mcpize/cli/main/schemas/mcpize.schema.json": "mcpize.yaml"
  }
}
```

## Links

- [Website](https://mcpize.com)
- [mcpize.yaml Reference](https://mcpize.com/case/mcpize-yaml)
- [JSON Schema](https://raw.githubusercontent.com/mcpize/cli/main/schemas/mcpize.schema.json)

## License

MIT
