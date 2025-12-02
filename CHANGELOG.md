# Changelog

All notable changes to MCPize CLI.

## [1.0.13] - 2025-12-02

### Fixed
- Remove internal GCP URL from rollback output (security)

## [1.0.12] - 2025-12-02

### Added
- `mcpize rollback` - Rollback to previous deployment
  - `--to <deployment_id>` - Rollback to specific deployment
  - `--steps <n>` - Rollback N deployments back (default: 1)
  - `--reason <reason>` - Add rollback reason
  - `-y, --yes` - Skip confirmation prompt

## [1.0.11] - 2025-12-02

### Fixed
- `mcpize logs --help` now shows accurate description for `-f` option

## [1.0.10] - 2025-12-02

### Changed
- `mcpize logs -f` polling interval changed from 2s to 10s (Cloud Logging has ~30s delay)
- Better messaging for follow mode: shows polling interval and delay warning

## [1.0.9] - 2025-12-02

### Fixed
- `mcpize --version` now shows correct version from package.json

## [1.0.8] - 2025-12-02

### Added
- `mcpize logs -f` / `--follow` - Log streaming with polling

## [1.0.7] - 2025-12-02

### Added
- `mcpize dev` - Local development server with hot reload
  - Auto-detects runtime (TypeScript, Python, PHP)
  - Loads environment variables from `.env` / `.env.local`
  - MCP Inspector integration (opens in browser)
  - Configurable port via `--port`

## [1.0.6] - 2025-12-01

### Added
- Pre-deploy validation: detect hardcoded ports (warns if not using `process.env.PORT`)
- Pre-deploy validation: detect missing secrets (scans code for `process.env.XXX`)
- Modular error analyzers architecture for multi-runtime support (Node.js, Python)
- Runtime-specific error analysis with actionable suggestions on deploy failure

### Changed
- `mcpize status` now shows public URLs (Marketplace + Gateway) instead of internal GCP URL
- Status cache TTL reduced from 5 minutes to 1 minute

## [1.0.5] - 2024-11-30

### Added
- Auto-discover MCP capabilities (tools, resources, prompts) after successful deploy
- Post-deploy wizard with monetization and SEO setup prompts

### Fixed
- Improved error logging for MCP discovery

## [1.0.1] - 2024-11-29

### Added
- `whoami` API validation with better auth error messages

## [1.0.0] - 2024-11-28

### Added
- `mcpize init` - Project scaffolding with TypeScript and OpenAPI templates
- `mcpize login` / `logout` / `whoami` - Authentication with auto-refresh tokens
- `mcpize deploy` - Deploy with auto-create server, `--yes`, `--wait`, `--notes`
- `mcpize status` - Server info, deployments, stats
- `mcpize logs` - Log streaming with `--type`, `--severity`, `--since` filters
- `mcpize secrets` - Secret management (`list`, `set`, `delete`, `export`)
- `mcpize doctor` - Comprehensive diagnostics
- `mcpize link` - Link project to existing server
