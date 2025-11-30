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
```

## Commands

| Command | Description |
|---------|-------------|
| `mcpize login` | Authenticate with MCPize |
| `mcpize logout` | Log out from MCPize |
| `mcpize init [name]` | Create a new MCP server project |
| `mcpize link` | Link current directory to an existing server |
| `mcpize deploy` | Deploy to MCPize Cloud |
| `mcpize status` | Show server status and deployments |
| `mcpize logs` | View runtime and build logs |
| `mcpize secrets list` | List environment secrets |
| `mcpize secrets set <name>` | Set a secret |
| `mcpize secrets delete <name>` | Delete a secret (alias: `rm`) |
| `mcpize doctor` | Run pre-deploy diagnostics |
| `mcpize whoami` | Show current authenticated user |

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

## Links

- [Website](https://mcpize.com)
- [Documentation](https://mcpize.com/docs)
- [GitHub](https://github.com/mcpize/cli)

## License

MIT
