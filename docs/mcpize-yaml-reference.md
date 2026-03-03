# mcpize.yaml Reference

Complete reference for the MCPize deployment manifest. Every field documented here is verified against runtime code.

---

## Overview

`mcpize.yaml` is the deployment manifest for MCP servers on MCPize. Place it in your project root. In monorepos, set `baseDir` in the Dashboard to point to your server's directory.

### When You Need It

- Declaring subscriber credentials (BYOK / per-user API keys)
- Declaring publisher secrets
- Overriding auto-detected build/start commands
- STDIO servers that need bridge wrapping

### When You Don't

MCPize auto-detects configuration from your project files. See [Auto-Detection](#auto-detection) for priority order.

---

## Quick Start

### TypeScript HTTP Server

```yaml
version: 1
runtime: typescript
entry: src/index.ts
build:
  install: npm ci
  command: npm run build
startCommand:
  type: http
  command: node dist/index.js
```

### Python STDIO Server with Per-User Credentials

```yaml
version: 1
runtime: python
entry: src/server.py
build:
  install: pip install -r requirements.txt
startCommand:
  type: stdio
  command: python src/server.py
credentials:
  - name: CLOUDFLARE_API_TOKEN
    required: true
    description: Your Cloudflare API token
    docs_url: https://dash.cloudflare.com/profile/api-tokens
credentials_mode: per_user
```

### Container (Custom Dockerfile)

```yaml
version: 1
runtime: container
build:
  dockerfile: Dockerfile
startCommand:
  type: http
```

---

## Field Reference

### Core Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `version` | No | `integer` | Schema version. Always `1`. |
| `name` | No | `string` | Server name. Auto-detected from `package.json` or `pyproject.toml` if omitted. |
| `description` | No | `string` | Short description of your server. |
| `runtime` | **Yes** | `string` | One of: `typescript`, `python`, `php`, `container`. |
| `entry` | No | `string` | Entry point file path (e.g., `src/index.ts`, `src/server.py`). |
| `pythonModulePath` | No | `string` | Python module path for pyproject.toml-based projects (e.g., `mymodule.server`). Used to generate start command: `python -m mymodule.server`. |

### build

| Field | Type | Description |
|-------|------|-------------|
| `build.install` | `string` | Dependency installation command. Examples: `npm ci`, `pip install -r requirements.txt`, `pip install .` |
| `build.command` | `string` | Build/compile command. Examples: `npm run build`, `tsc` |
| `build.dockerfile` | `string` | Path to Dockerfile. Only used when `runtime: container`. |

### startCommand

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `startCommand.type` | **Yes** (if `startCommand` present) | `string` | Transport protocol: `http`, `sse`, or `stdio`. Determines deployment mode. `startCommand` itself is optional — auto-detected if omitted. |
| `startCommand.command` | No | `string` | Start command (e.g., `node dist/index.js`, `python src/server.py`). |
| `startCommand.args` | No | `string[]` | Additional command arguments. Combined with command at runtime. |

#### Transport Types and Deployment Behavior

`startCommand.type` is the most important deployment decision:

| Type | What Happens |
|------|-------------|
| `stdio` | Always wrapped with mcp-bridge. Bridge handles HTTP↔STDIO translation, per-request credential injection via ENV. |
| `http` + `per_user` credentials (ENV-based) | Wrapped with mcp-http-bridge in **wrapper mode**. Per-user processes with ENV credential injection. |
| `http` + Python runtime | Wrapped with mcp-http-bridge in **proxy mode**. Single upstream process, DNS rebinding fix. |
| `http` + `shared` credentials | Direct deployment. Standard Docker image on Cloud Run, one process. |
| `sse` | Treated as `http` for deployment purposes. |

### bridge (Legacy)

| Field | Type | Description |
|-------|------|-------------|
| `bridge.mode` | `string` | One of: `http`, `sse`, `stdio`. **Legacy field** — `startCommand.type` takes priority. Kept for backwards compatibility. |

---

## Secrets (Publisher Credentials)

Secrets are API keys that **you** (the publisher) provide at deploy time. They are infrastructure credentials — your OpenAI key, database URL, etc.

```yaml
secrets:
  - name: OPENAI_API_KEY
    required: true
    description: OpenAI API key for completions
  - name: DATABASE_URL
    required: true
    description: Postgres connection string
```

### Secret Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | **Yes** | `string` | Environment variable name. Must be `SCREAMING_SNAKE_CASE` (pattern: `^[A-Z][A-Z0-9_]*$`). |
| `required` | **Yes** | `boolean` | Whether deployment fails without this secret. |
| `description` | No | `string` | Help text shown in Dashboard. |
| `pattern` | No | `string` | Validation regex pattern. |
| `placeholder` | No | `string` | Example value shown in Dashboard. |

### How Secrets Reach Your Server

Secrets are set as Cloud Run environment variables at deploy time. Your code reads them with `process.env.OPENAI_API_KEY` or `os.environ["DATABASE_URL"]`. One copy per server, shared across all requests.

---

## Credentials (Subscriber / BYOK)

Credentials are API keys that **each subscriber** provides — their own GitHub token, Cloudflare key, etc. This is the BYOK (Bring Your Own Key) model.

```yaml
credentials:
  - name: GITHUB_TOKEN
    required: true
    description: Your GitHub personal access token
    docs_url: https://github.com/settings/tokens
credentials_mode: per_user
```

### Credential Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | **Yes** | `string` | Credential identifier. Must be `SCREAMING_SNAKE_CASE`. **For STDIO servers, this is the environment variable name your code reads.** Name it exactly what your code expects in `os.environ` or `process.env`. |
| `required` | **Yes** | `boolean` | Whether the server is functional without this credential. If any credential has `required: true`, `credentials_mode` is auto-detected as `per_user`. |
| `description` | No | `string` | Help text shown to subscribers when they add their keys. |
| `docs_url` | No | `string` (URI) | URL to documentation on how to obtain this credential. Shown as a help link. |
| `pattern` | No | `string` | Validation regex. Applied when subscriber saves credentials. |
| `placeholder` | No | `string` | Example value shown in the input field. |

### mapping (Optional)

Controls how credentials are injected into your server at runtime.

| Field | Works | When | Description |
|-------|-------|------|-------------|
| `mapping.header` | **Yes** | HTTP/SSE servers | Custom HTTP header name. If omitted, auto-generated: `GITHUB_TOKEN` → `X-MCP-Github-Token`. |
| `mapping.arg` | **Yes** | STDIO servers with bridge | CLI argument name. If omitted, auto-generated: `FB_TOKEN` → `--fb-token`, `apiKey` → `--api-key`. Passed via `--credential-arg-map` flag. |
| `mapping.env` | **No effect** | — | Defined in schema but **not read at runtime** by bridge or gateway. The credential `name` field is used as the ENV var name directly. Do not rely on this field. |

### credentials_mode

| Value | Effect |
|-------|--------|
| `per_user` | Each subscriber provides their own API keys. Subscribers are prompted to enter credentials. |
| `shared` | Publisher provides all secrets at deploy time. Subscribers don't need their own keys. Default. |
| *(omitted)* | Auto-detected: if any credential has `required: true` → `per_user`, otherwise `shared`. |

---

## How Credentials Reach Your Server at Runtime

This is the critical section. The injection mechanism depends on your server's transport type.

### STDIO Servers (bridge mode)

```
Subscriber saves credentials in Dashboard:
  {"CLOUDFLARE_API_TOKEN": "cf-xxx", "ACCOUNT_ID": "abc123"}
        │
        ▼
mcp-bridge receives request, fetches credentials from DB
        │
        ▼
Decrypts JSON, injects as environment variables:
  CLOUDFLARE_API_TOKEN=cf-xxx
  ACCOUNT_ID=abc123
        │
        ▼
Your server process starts with these ENV vars.
Your code: os.environ["CLOUDFLARE_API_TOKEN"]  ✓
```

**Key rule:** The credential `name` field IS the environment variable name. There is no mapping layer for ENV — `mapping.env` has no effect.

If `mapping.arg` is defined (or auto-generated from `name`), the bridge also passes credentials as CLI arguments via `--credential-arg-map`. Example: credential `FB_TOKEN` with `mapping.arg: --fb-token` → bridge starts your server with `--fb-token <value>`.

### HTTP/SSE Servers — Per-User with Bridge (wrapper mode)

Same as STDIO: per-user processes with ENV injection. The mcp-http-bridge spawns a separate upstream process per user, injecting credentials as environment variables.

```
Your code: process.env.GITHUB_TOKEN  ✓
```

This mode is used when `startCommand.type: http` and `credentials_mode: per_user` with ENV-based credentials.

### HTTP/SSE Servers — Direct Mode (shared credentials)

Publisher secrets are set as Cloud Run environment variables at deploy time. One process serves all requests.

```
Your code: process.env.OPENAI_API_KEY  ✓
```

### HTTP/SSE Servers — Direct Mode (per-user via headers)

For HTTP servers where the gateway injects per-user credentials as HTTP headers:

```
Subscriber saves: {"GITHUB_TOKEN": "ghp-xxx"}
        │
        ▼
Gateway decrypts, maps to header name:
  - Uses mapping.header if defined
  - Otherwise auto-generates: GITHUB_TOKEN → X-MCP-Github-Token
        │
        ▼
Request forwarded with header:
  X-MCP-Github-Token: ghp-xxx
        │
        ▼
Your server reads: request.headers["X-MCP-Github-Token"]
```

**Header priority:** Client-sent `X-MCP-*` headers > Stored subscriber credentials > Publisher secrets (fallback for shared mode).

### Header Name Auto-Generation

If `mapping.header` is not specified, the header name is generated from the credential `name`:

| Credential Name | Generated Header |
|----------------|-----------------|
| `GITHUB_TOKEN` | `X-MCP-Github-Token` |
| `META_ACCESS_TOKEN` | `X-MCP-Meta-Access-Token` |
| `OPENAI_API_KEY` | `X-MCP-Openai-Api-Key` |

Rule: split on `_`, title-case each part, join with `-`, prefix with `X-MCP-`.

### CLI Arg Auto-Generation (STDIO)

If `mapping.arg` is not specified, the argument name is generated from the credential `name`:

| Credential Name | Generated Arg |
|----------------|--------------|
| `FB_TOKEN` | `--fb-token` |
| `CLOUDFLARE_API_TOKEN` | `--cloudflare-api-token` |

Rule: split on `_`, lowercase, join with `-`, prefix with `--`.

---

## Deployment Decision Matrix

How `startCommand.type` + `credentials_mode` + `runtime` determine what MCPize builds:

Rows are evaluated top-to-bottom. First match wins.

```
┌─────────────────────┬──────────────────┬─────────────────────────────────────┐
│ startCommand.type   │ credentials_mode │ Deployment                          │
├─────────────────────┼──────────────────┼─────────────────────────────────────┤
│ stdio               │ any              │ mcp-bridge (STDIO→HTTP, always)     │
│ http + per_user     │ per_user (ENV)   │ mcp-http-bridge wrapper mode        │
│ http + python       │ shared           │ mcp-http-bridge proxy mode (DNS fix)│
│ http + shared       │ shared           │ Direct Docker + Cloud Run           │
│ sse                 │ (same as http)   │ (same as http)                      │
└─────────────────────┴──────────────────┴─────────────────────────────────────┘
```

Note: `per_user` takes priority over the Python runtime catch-all. A Python HTTP server with `per_user` credentials uses **wrapper mode** (per-user processes), not proxy mode.

---

## Complete Examples

### 1. Python STDIO + Per-User Credentials

The most common pattern for BYOK servers. Server reads credentials from environment variables.

```yaml
version: 1
runtime: python
entry: src/server.py
build:
  install: pip install -r requirements.txt
startCommand:
  type: stdio
  command: python src/server.py
credentials:
  - name: CLOUDFLARE_API_TOKEN
    required: true
    description: Cloudflare API token with DNS edit permissions
    docs_url: https://dash.cloudflare.com/profile/api-tokens
  - name: CLOUDFLARE_ZONE_ID
    required: false
    description: Zone ID (optional, auto-detected if omitted)
credentials_mode: per_user
```

Server code reads: `os.environ["CLOUDFLARE_API_TOKEN"]`

### 2. TypeScript HTTP + Publisher Secrets

Publisher owns all API keys. Subscribers don't need their own.

```yaml
version: 1
runtime: typescript
entry: src/index.ts
build:
  install: npm ci
  command: npm run build
startCommand:
  type: http
  command: node dist/index.js
secrets:
  - name: OPENAI_API_KEY
    required: true
    description: OpenAI API key for completions
  - name: DATABASE_URL
    required: true
    description: Postgres connection string
```

### 3. TypeScript HTTP + Per-User Headers

Subscribers bring their own GitHub tokens. Server reads them from HTTP headers.

```yaml
version: 1
runtime: typescript
entry: src/index.ts
build:
  install: npm ci
  command: npm run build
startCommand:
  type: http
  command: node dist/index.js
credentials:
  - name: GITHUB_TOKEN
    required: true
    description: GitHub personal access token (repo scope)
    docs_url: https://github.com/settings/tokens
    mapping:
      header: X-GitHub-Token
credentials_mode: per_user
```

Server code reads: `request.headers["X-GitHub-Token"]`

### 4. Python HTTP + Per-User ENV

Python HTTP server that reads credentials from environment. Auto-wrapped with mcp-http-bridge in wrapper mode — each user gets their own process with ENV vars injected.

```yaml
version: 1
runtime: python
entry: src/server.py
build:
  install: pip install -r requirements.txt
startCommand:
  type: http
  command: python src/server.py
credentials:
  - name: AWS_ACCESS_KEY_ID
    required: true
    description: AWS access key
  - name: AWS_SECRET_ACCESS_KEY
    required: true
    description: AWS secret key
  - name: AWS_REGION
    required: false
    description: AWS region (defaults to us-east-1)
    placeholder: us-east-1
credentials_mode: per_user
```

Server code reads: `os.environ["AWS_ACCESS_KEY_ID"]`

### 5. Python with pyproject.toml

Module-based Python project using `python -m` execution.

```yaml
version: 1
runtime: python
pythonModulePath: mypackage.server
build:
  install: pip install .
startCommand:
  type: stdio
  command: python
  args: ["-m", "mypackage.server"]
credentials:
  - name: API_TOKEN
    required: true
    description: Service API token
credentials_mode: per_user
```

### 6. STDIO Server with Custom CLI Args

Server uses argparse/click and expects credentials as CLI arguments.

```yaml
version: 1
runtime: python
entry: src/server.py
build:
  install: pip install -r requirements.txt
startCommand:
  type: stdio
  command: python src/server.py
credentials:
  - name: API_KEY
    required: true
    description: API key
    mapping:
      arg: --api-key
  - name: API_SECRET
    required: true
    description: API secret
    mapping:
      arg: --secret
credentials_mode: per_user
```

Bridge passes: `python src/server.py --api-key <value> --secret <value>`

---

## Auto-Detection

When `mcpize.yaml` is absent, MCPize detects configuration from project files in this order:

| Priority | Source | Detection |
|----------|--------|-----------|
| 1 | `mcpize.yaml` | Used as-is |
| 2 | `smithery.yaml` | Auto-converted to mcpize format |
| 3 | `package.json` + `tsconfig.json` | TypeScript runtime |
| 4 | `pyproject.toml` | Python runtime, extracts module path from `[project.scripts]` |
| 5 | `requirements.txt` | Python runtime |
| 6 | `composer.json` | PHP runtime |
| 7 | `Dockerfile` | Container runtime |

Auto-detection covers `runtime`, `entry`, `build`, and `startCommand`. It cannot detect `credentials` or `secrets` — you must declare those in `mcpize.yaml`.

### When You Must Provide mcpize.yaml

- Your server requires subscriber credentials (BYOK)
- You want to declare publisher secrets
- Auto-detected build/start commands are wrong
- You need `startCommand.type: stdio` (auto-detection may default to `http`)

---

## CLI Validation

The MCPize CLI validates `mcpize.yaml` with a Zod schema before deployment:

- All fields are type-checked
- `runtime` must be one of: `typescript`, `python`, `php`, `container`
- `startCommand.type` must be one of: `http`, `sse`, `stdio`
- Credential and secret `name` fields must match `^[A-Z][A-Z0-9_]*$`
- Deploy exits with a validation error if the manifest is invalid
- The manifest file is included in the deploy tarball

---

## Common Mistakes

| Problem | Cause | Fix |
|---------|-------|-----|
| "failed to read from stdout: EOF" | Server crashes at startup (missing deps, import errors) | Test locally: run your start command in a clean env with no credentials set |
| Server deploys but users aren't prompted for keys | No `credentials` section in manifest | Add `credentials` with `required: true` + set `credentials_mode: per_user` |
| Credential name doesn't match env var | `name` IS the env var for STDIO/bridge servers | Set credential `name` to exactly what your code reads from `os.environ` |
| `mapping.env` doesn't work | Not implemented at runtime | Use the credential `name` as the env var name instead |
| HTTP server can't read per-user ENV | Direct mode = one shared process | Add `credentials_mode: per_user` → auto-wrapped with http-bridge for per-process ENV injection |
| Custom Dockerfile + STDIO | Two-stage build | Your Dockerfile is built first as base image, then wrapped with mcp-bridge |
| `bridge.mode` ignored | Legacy field | Use `startCommand.type` instead |

---

## Secrets vs Credentials — Quick Reference

| Aspect | Secrets | Credentials |
|--------|---------|-------------|
| Who provides | You (publisher) | Each subscriber |
| When | At deploy time, via Dashboard | At subscription time |
| Use case | Your infrastructure (DB, APIs you own) | User's own API keys (BYOK) |
| Storage | Encrypted, per-server | Encrypted, per-user-per-server |
| Injection | Cloud Run ENV vars | Bridge ENV / Gateway headers |
| Manifest field | `secrets` | `credentials` |

---

## IDE Autocomplete

For VS Code YAML autocomplete, add to `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "https://raw.githubusercontent.com/mcpize/cli/main/schemas/mcpize.schema.json": "mcpize.yaml"
  }
}
```

---

## JSON Schema

The full JSON Schema is at [`schemas/mcpize.schema.json`](../schemas/mcpize.schema.json) in this repository.
