import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { readFileSync } from "node:fs";
import { getServerGatewayUrl } from "../lib/config.js";
import { getValidToken } from "../lib/auth.js";
import { withRetry, APIError, NetworkError } from "../lib/api.js";

interface RunOptions {
  list?: boolean;
  json?: boolean;
  apiKey?: string;
  file?: string;
  set?: string[];
  dryRun?: boolean;
  verbose?: boolean;
}

interface ToolInfo {
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown>;
  examplePrompt: string | null;
  exampleArgs: Record<string, unknown> | null;
}

interface ToolListResponse {
  tools: ToolInfo[];
  meta: { server: string; tool_count: number; last_discovered_at: string | null };
}

interface SuccessResponse {
  type: "json" | "text" | "multi";
  data: unknown;
  meta: { tool: string; server: string; latency_ms: number };
}

interface ErrorResponse {
  type: "error";
  error: { code: string; message: string; tool?: string };
}

type ToolResponse = SuccessResponse | ErrorResponse;

// ─── Helpers ────────────────────────────────────────────────────

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

function coerce(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  return value;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

// ─── Auth ───────────────────────────────────────────────────────

async function resolveToken(options: RunOptions): Promise<string> {
  // --api-key flag takes priority (convenience for run-specific use)
  if (options.apiKey) return options.apiKey;

  // Falls through to standard auth: --token > MCPIZE_TOKEN > session
  const token = await getValidToken();
  if (!token) {
    console.error(
      chalk.red("Not authenticated. Run: mcpize login — or set MCPIZE_TOKEN"),
    );
    process.exit(1);
  }
  return token;
}

// ─── Argument Resolution ────────────────────────────────────────

async function resolveArgs(
  argsJson: string | undefined,
  options: RunOptions,
): Promise<Record<string, unknown>> {
  let args: Record<string, unknown> = {};

  // 1. Stdin pipe (lowest priority)
  if (!process.stdin.isTTY && !argsJson && !options.file) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const stdinData = Buffer.concat(chunks).toString("utf-8").trim();
      if (stdinData) {
        args = JSON.parse(stdinData);
      }
    } catch {
      console.error(chalk.red("Invalid JSON from stdin. Check syntax."));
      process.exit(1);
    }
  }

  // 2. File input
  if (options.file) {
    try {
      let fileContent: string;
      if (options.file === "-") {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        fileContent = Buffer.concat(chunks).toString("utf-8").trim();
      } else {
        fileContent = readFileSync(options.file, "utf-8").trim();
      }
      if (fileContent) {
        args = { ...args, ...JSON.parse(fileContent) };
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        console.error(chalk.red(`File not found: ${options.file}`));
      } else {
        console.error(chalk.red("Invalid JSON in file. Check syntax."));
      }
      process.exit(1);
    }
  }

  // 3. Inline JSON
  if (argsJson) {
    try {
      args = { ...args, ...JSON.parse(argsJson) };
    } catch {
      console.error(chalk.red("Invalid JSON argument. Check syntax or use -s key=value"));
      process.exit(1);
    }
  }

  // 4. --set flags (highest priority)
  if (options.set && options.set.length > 0) {
    for (const pair of options.set) {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        console.error(chalk.red(`Invalid --set format: "${pair}". Use key=value`));
        process.exit(1);
      }
      const key = pair.slice(0, eqIndex);
      const value = pair.slice(eqIndex + 1);
      setNestedValue(args, key, coerce(value));
    }
  }

  return args;
}

// ─── Tool Listing ───────────────────────────────────────────────

async function listTools(
  slug: string,
  token: string,
  options: RunOptions,
): Promise<void> {
  const url = `${getServerGatewayUrl(slug)}/api/v1/tools`;
  const spinner = options.json ? null : ora("Fetching tools...").start();

  try {
    const response = await withRetry(() =>
      fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    if (!response.ok) {
      spinner?.fail();
      await handleHttpError(response, slug);
      return;
    }

    const body = (await response.json()) as ToolListResponse;
    spinner?.stop();

    if (options.json) {
      console.log(JSON.stringify(body, null, 2));
      return;
    }

    if (body.tools.length === 0) {
      console.log(chalk.yellow(`${slug} — no tools discovered yet`));
      console.log(chalk.dim("The server may still be deploying."));
      return;
    }

    console.log(
      `\n${chalk.bold(slug)} — ${body.tools.length} tool${body.tools.length === 1 ? "" : "s"}\n`,
    );

    const maxNameLen = Math.max(...body.tools.map((t) => t.name.length));
    for (const tool of body.tools) {
      const name = chalk.cyan(tool.name.padEnd(maxNameLen + 2));
      const desc = chalk.dim(tool.description || "No description");
      console.log(`  ${name}${desc}`);
    }

    console.log(
      `\n${chalk.dim(`Usage: mcpize run ${slug}/<tool> '{"arg": "value"}'`)}`,
    );
  } catch (error) {
    spinner?.fail("Failed to fetch tools");
    handleFetchError(error, slug);
  }
}

// ─── Tool Call ──────────────────────────────────────────────────

async function callTool(
  slug: string,
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  options: RunOptions,
): Promise<void> {
  const url = `${getServerGatewayUrl(slug)}/api/v1/tools/${toolName}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify(args);

  // Dry run
  if (options.dryRun) {
    console.log(chalk.bold("\nDry run — request that would be sent:\n"));
    console.log(`${chalk.green("POST")} ${url}`);
    console.log(chalk.dim("Headers:"));
    console.log(chalk.dim(`  Authorization: Bearer ${token.slice(0, 8)}...`));
    console.log(chalk.dim(`  Content-Type: application/json`));
    if (Object.keys(args).length > 0) {
      console.log(chalk.dim("Body:"));
      console.log(JSON.stringify(args, null, 2));
    }
    return;
  }

  const spinner = options.json ? null : ora(`Running ${slug}/${toolName}...`).start();

  try {
    const response = await withRetry(() =>
      fetch(url, { method: "POST", headers, body }),
    );

    if (options.verbose) {
      spinner?.stop();
      console.log(chalk.dim(`\n${response.status} ${response.statusText}`));
      response.headers.forEach((v, k) => console.log(chalk.dim(`  ${k}: ${v}`)));
      console.log();
    }

    if (!response.ok) {
      spinner?.fail();
      await handleHttpError(response, slug, toolName);
      return;
    }

    const result = (await response.json()) as ToolResponse;
    spinner?.stop();
    formatResponse(result, slug, toolName, options);
  } catch (error) {
    spinner?.fail(`Failed to call ${slug}/${toolName}`);
    handleFetchError(error, slug);
  }
}

// ─── Response Formatting ────────────────────────────────────────

function formatResponse(
  result: ToolResponse,
  slug: string,
  toolName: string,
  options: RunOptions,
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.type === "error") {
    console.error(chalk.red(`\n✖ Tool error: ${result.error.message}`));
    process.exit(1);
  }

  const meta = result.meta;
  console.log(
    `\n${chalk.green("✔")} ${chalk.bold(`${slug}/${toolName}`)}  ${chalk.dim(`${meta.latency_ms}ms`)}\n`,
  );

  if (result.type === "text") {
    console.log(result.data as string);
  } else if (result.type === "json") {
    console.log(JSON.stringify(result.data, null, 2));
  } else if (result.type === "multi") {
    const items = result.data as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    for (const item of items) {
      if (item.type === "text" && item.text) {
        console.log(item.text);
      } else if (item.type === "image") {
        console.log(
          chalk.dim(
            `[${item.mimeType || "image"}: ${item.data ? Math.round(item.data.length * 0.75 / 1024) + "KB" : "unknown size"}]`,
          ),
        );
      } else {
        console.log(chalk.dim(`[${item.type} content]`));
      }
    }
  }
}

// ─── Error Handling ─────────────────────────────────────────────

async function handleHttpError(
  response: Response,
  slug: string,
  toolName?: string,
): Promise<void> {
  let body: ErrorResponse | undefined;
  try {
    body = (await response.json()) as ErrorResponse;
  } catch {
    // non-JSON error response
  }

  const message = body?.error?.message;

  switch (response.status) {
    case 401:
      console.error(
        chalk.red("Authentication failed. Run: mcpize login"),
      );
      break;
    case 404:
      if (toolName) {
        console.error(
          chalk.red(
            `Tool '${toolName}' not found on '${slug}'. Run: mcpize run ${slug} --list`,
          ),
        );
      } else {
        console.error(
          chalk.red(`Server '${slug}' not found. Check the slug at mcpize.com`),
        );
      }
      break;
    case 422:
      console.error(chalk.red(`Tool error: ${message || "Execution failed"}`));
      break;
    case 429:
      console.error(
        chalk.red("Quota exceeded. Check your plan at mcpize.com/pricing"),
      );
      break;
    case 504:
      console.error(
        chalk.red("Server timed out (30s). The tool may need more time."),
      );
      break;
    default:
      console.error(
        chalk.red(message || `Request failed with status ${response.status}`),
      );
  }
  process.exit(1);
}

function handleFetchError(error: unknown, slug: string): void {
  if (error instanceof APIError) {
    console.error(chalk.red(error.message));
  } else if (error instanceof NetworkError) {
    console.error(
      chalk.red(
        `Cannot reach ${slug}.${process.env.MCPIZE_GATEWAY_DOMAIN || "mcpize.run"}. Check your connection.`,
      ),
    );
  } else {
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
  }
  process.exit(1);
}

// ─── Command ────────────────────────────────────────────────────

export const runCommand = new Command("run")
  .description("Run an MCP server tool via REST API")
  .argument("[target]", "server-slug or server-slug/tool-name")
  .argument("[args]", "JSON arguments for the tool")
  .option("-l, --list", "List available tools for the server")
  .option("-j, --json", "Raw JSON output (pipeable)")
  .option("-k, --api-key <key>", "API key (overrides session)")
  .option("-f, --file <path>", "Read arguments from JSON file (- for stdin)")
  .option("-s, --set <pair>", "Set argument key=value (repeatable)", collect, [])
  .option("--dry-run", "Show request without executing")
  .option("-v, --verbose", "Show request/response headers and timing")
  .action(async (target: string | undefined, argsJson: string | undefined, options: RunOptions) => {
    if (!target) {
      console.error(chalk.red("Usage: mcpize run <server>/<tool> [json-args]"));
      console.error(chalk.dim("       mcpize run <server> --list"));
      process.exit(1);
    }

    const slashIndex = target.indexOf("/");
    const slug = slashIndex === -1 ? target : target.slice(0, slashIndex);
    const toolName = slashIndex === -1 ? null : target.slice(slashIndex + 1);

    if (!slug) {
      console.error(chalk.red("Server slug is required."));
      process.exit(1);
    }

    const token = await resolveToken(options);

    // List tools: explicit --list flag OR no tool specified
    if (options.list || !toolName) {
      await listTools(slug, token, options);
      return;
    }

    const args = await resolveArgs(argsJson, options);
    await callTool(slug, toolName, args, token, options);
  });
