import { Command } from "commander";
import chalk from "chalk";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { parse as parseYaml } from "yaml";
import {
  createTunnel,
  type TunnelConnection,
  type TunnelProviderType,
} from "../tunnel/index.js";

interface McpizeManifest {
  runtime?: string;
  entry?: string;
  startCommand?: {
    type?: string;
    command?: string;
  };
  build?: {
    command?: string;
  };
}

interface DevOptions {
  port: string;
  build: boolean;
  tunnel: boolean;
  provider?: TunnelProviderType;
  playground?: boolean;
  entry?: string;
}

/**
 * Detect runtime from project files
 */
function detectRuntime(
  cwd: string,
): "typescript" | "python" | "php" | "unknown" {
  // Check mcpize.yaml first
  const manifestPath = join(cwd, "mcpize.yaml");
  if (existsSync(manifestPath)) {
    try {
      const manifest = parseYaml(
        readFileSync(manifestPath, "utf-8"),
      ) as McpizeManifest;
      if (
        manifest.runtime === "typescript" ||
        manifest.runtime === "python" ||
        manifest.runtime === "php"
      ) {
        return manifest.runtime;
      }
    } catch {
      // Continue with file detection
    }
  }

  // File-based detection
  if (existsSync(join(cwd, "package.json"))) return "typescript";
  if (
    existsSync(join(cwd, "requirements.txt")) ||
    existsSync(join(cwd, "pyproject.toml"))
  )
    return "python";
  if (existsSync(join(cwd, "composer.json"))) return "php";

  return "unknown";
}

/**
 * Get dev command based on runtime
 */
function getDevCommand(
  cwd: string,
  runtime: string,
  customEntry?: string,
): { cmd: string; args: string[] } {
  // Check package.json for custom dev script
  if (runtime === "typescript") {
    // Custom entry takes priority over package.json scripts
    if (customEntry) {
      return { cmd: "npx", args: ["tsx", "watch", customEntry] };
    }

    const pkgPath = join(cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts?.dev) {
          return { cmd: "npm", args: ["run", "dev"] };
        }
      } catch {
        // Continue with defaults
      }
    }
    // Fallback: tsx watch
    return { cmd: "npx", args: ["tsx", "watch", "src/index.ts"] };
  }

  if (runtime === "python") {
    // Custom entry for Python
    if (customEntry) {
      // Convert file path to module notation for uvicorn if it looks like a module
      if (customEntry.endsWith(":app") || customEntry.includes(":")) {
        return {
          cmd: "uvicorn",
          args: [customEntry, "--reload", "--host", "0.0.0.0"],
        };
      }
      // Direct python execution with watchdog
      return {
        cmd: "python",
        args: [
          "-m",
          "watchdog.watchmedo",
          "auto-restart",
          "--patterns=*.py",
          "--recursive",
          "--",
          "python",
          customEntry,
        ],
      };
    }

    // Check for uvicorn (FastAPI/FastMCP)
    const reqPath = join(cwd, "requirements.txt");
    if (existsSync(reqPath)) {
      const reqs = readFileSync(reqPath, "utf-8");
      if (reqs.includes("uvicorn") || reqs.includes("fastmcp")) {
        return {
          cmd: "uvicorn",
          args: ["src.main:app", "--reload", "--host", "0.0.0.0"],
        };
      }
    }
    // Fallback: python with watchdog
    return {
      cmd: "python",
      args: [
        "-m",
        "watchdog.watchmedo",
        "auto-restart",
        "--patterns=*.py",
        "--recursive",
        "--",
        "python",
        "src/main.py",
      ],
    };
  }

  if (runtime === "php") {
    // Custom entry for PHP (document root)
    const docRoot = customEntry || "public";
    return { cmd: "php", args: ["-S", "0.0.0.0:8080", "-t", docRoot] };
  }

  return { cmd: "echo", args: ["Unknown runtime"] };
}

/**
 * Load environment variables from .env files
 */
function loadEnvVars(cwd: string): Record<string, string> {
  const env: Record<string, string> = {};

  // Priority: .env.local > .env
  const envFiles = [".env", ".env.local"];

  for (const file of envFiles) {
    const envPath = join(cwd, file);
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            const [key, ...valueParts] = trimmed.split("=");
            if (key && valueParts.length > 0) {
              env[key.trim()] = valueParts
                .join("=")
                .trim()
                .replace(/^["']|["']$/g, "");
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return env;
}

/**
 * Open playground URL in browser
 */
function openBrowser(url: string): void {
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(openCmd, [url], { stdio: "ignore", shell: true, detached: true });
}

/**
 * Copy text to clipboard using native commands
 */
function copyToClipboard(text: string): boolean {
  try {
    let cmd: string;
    let args: string[];

    if (process.platform === "darwin") {
      cmd = "pbcopy";
      args = [];
    } else if (process.platform === "win32") {
      cmd = "clip";
      args = [];
    } else {
      // Linux: try xclip first, xsel as fallback
      cmd = "xclip";
      args = ["-selection", "clipboard"];
    }

    const proc = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"], shell: true });
    proc.stdin?.write(text);
    proc.stdin?.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get playground URL for tunnel
 */
function getPlaygroundUrl(tunnelUrl: string): string {
  return `https://mcpize.com/playground?url=${encodeURIComponent(tunnelUrl)}`;
}

/**
 * Check if a port is available (not in use)
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        // Other errors - assume port is available
        resolve(true);
      }
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, "127.0.0.1");
  });
}

/**
 * Get process info using the port (cross-platform)
 */
async function getPortProcess(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? "netstat" : "lsof";
    const args = isWindows
      ? ["-ano", "|", "findstr", `:${port}`]
      : ["-i", `:${port}`, "-P", "-n"];

    const proc = spawn(cmd, args, {
      shell: true,
      stdio: ["ignore", "pipe", "ignore"]
    });

    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", () => {
      if (output.trim()) {
        // Extract process name/PID from first line
        const firstLine = output.trim().split("\n")[0];
        resolve(firstLine);
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => resolve(null));
  });
}

/**
 * Wait for server to be healthy by polling the MCP endpoint
 */
async function waitForServer(port: number, maxAttempts = 30): Promise<boolean> {
  const url = `http://localhost:${port}/mcp`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "mcpize-cli", version: "1.0.0" },
          },
          id: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json() as { result?: unknown; jsonrpc?: string };
        // Check if we got a valid MCP response
        if (data.result || data.jsonrpc === "2.0") {
          return true;
        }
      }
    } catch {
      // Server not ready yet, continue polling
    }

    // Wait 1 second before next attempt
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Show progress dots
    if (attempt % 5 === 0) {
      process.stdout.write(".");
    }
  }

  return false;
}

export const devCommand = new Command("dev")
  .description("Run local development server with hot reload")
  .argument("[entry]", "Entry file (e.g., src/server.ts, app.main:app)")
  .option("-p, --port <port>", "Port to run on", "3000")
  .option("--no-build", "Skip initial build step")
  .option("-t, --tunnel", "Expose server via public tunnel URL")
  .option(
    "--provider <provider>",
    "Tunnel provider: localtunnel, ngrok, cloudflared",
  )
  .option("--playground", "Open MCPize Playground instead of just showing URL")
  .action(async (entry: string | undefined, options: DevOptions) => {
    const cwd = process.cwd();
    const port = parseInt(options.port, 10);

    // --playground implies --tunnel (playground needs public URL)
    if (options.playground) {
      options.tunnel = true;
    }

    console.log(chalk.bold("\nMCPize Dev Server\n"));

    // 1. Detect runtime
    const runtime = detectRuntime(cwd);
    if (runtime === "unknown") {
      console.log(chalk.red("✖ Could not detect runtime"));
      console.log(
        chalk.gray(
          "  Ensure you have package.json, requirements.txt, or composer.json",
        ),
      );
      process.exit(1);
    }
    console.log(`Runtime: ${chalk.cyan(runtime)}`);

    // 2. Check for mcpize.yaml
    const manifestPath = join(cwd, "mcpize.yaml");
    if (!existsSync(manifestPath)) {
      console.log(chalk.yellow("⚠ No mcpize.yaml found. Using defaults."));
    }

    // 3. Load environment variables
    const envVars = loadEnvVars(cwd);
    const envCount = Object.keys(envVars).length;
    if (envCount > 0) {
      console.log(`Env vars: ${chalk.cyan(envCount)} loaded from .env`);
    }

    // 4. Check if port is available
    const portAvailable = await isPortAvailable(port);
    if (!portAvailable) {
      console.log(chalk.red(`\n✖ Port ${port} is already in use`));

      // Try to show what's using it
      const processInfo = await getPortProcess(port);
      if (processInfo) {
        console.log(chalk.gray(`  Process: ${processInfo.substring(0, 80)}...`));
      }

      console.log(chalk.gray(`\n  Options:`));
      console.log(chalk.gray(`  1. Kill the process: ${chalk.white(`lsof -ti:${port} | xargs kill -9`)}`));
      console.log(chalk.gray(`  2. Use different port: ${chalk.white(`mcpize dev --port ${port + 1}`)}`));
      process.exit(1);
    }
    console.log(`Port: ${chalk.cyan(port)} (available)`);

    // 5. Run initial build for TypeScript (if needed)
    if (options.build && runtime === "typescript") {
      const pkgPath = join(cwd, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts?.build) {
          console.log(chalk.gray("\nRunning initial build..."));
          await new Promise<void>((resolve, reject) => {
            const build = spawn("npm", ["run", "build"], {
              cwd,
              stdio: "inherit",
              shell: true,
            });
            build.on("close", (code) => {
              if (code === 0) resolve();
              else reject(new Error(`Build failed with code ${code}`));
            });
            build.on("error", reject);
          }).catch((err) => {
            console.log(chalk.red(`✖ Build failed: ${err.message}`));
            process.exit(1);
          });
        }
      }
    }

    // 5. Get dev command (with custom entry if provided)
    const { cmd, args } = getDevCommand(cwd, runtime, entry);
    if (entry) {
      console.log(`Entry: ${chalk.cyan(entry)}`);
    }

    // 6. Prepare environment
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...envVars,
      PORT: String(port),
      NODE_ENV: "development",
    };

    // 7. Print command info
    console.log(chalk.gray("\n─────────────────────────────────────────\n"));
    console.log(chalk.gray(`$ ${cmd} ${args.join(" ")}\n`));

    // 8. Spawn dev process FIRST
    const child: ChildProcess = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env,
    });

    let tunnel: TunnelConnection | null = null;

    // Handle signals
    const cleanup = async () => {
      if (tunnel) {
        console.log(chalk.gray("\nClosing tunnel..."));
        await tunnel.close();
      }
      child.kill("SIGTERM");
      process.exit(0);
    };
    process.on("SIGINT", () => void cleanup());
    process.on("SIGTERM", () => void cleanup());

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        console.log(chalk.red(`\n✖ Dev server exited with code ${code}`));
      }
      process.exit(code ?? 0);
    });

    child.on("error", (err) => {
      console.log(chalk.red(`\n✖ Failed to start dev server: ${err.message}`));
      process.exit(1);
    });

    // 9. Wait for server to be healthy before setting up tunnel
    if (options.tunnel) {
      // Give the process a moment to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      process.stdout.write(chalk.gray("\nWaiting for server to be ready"));

      const isHealthy = await waitForServer(port);

      if (!isHealthy) {
        console.log(chalk.red("\n✖ Server failed to start or /mcp endpoint not responding"));
        console.log(chalk.gray("  Make sure your server exposes POST /mcp endpoint"));
        console.log(chalk.gray("  Continuing without tunnel...\n"));
      } else {
        console.log(chalk.green(" ✓\n"));

        // 10. Now setup tunnel
        try {
          tunnel = await createTunnel(port, options.provider as TunnelProviderType);

          // Copy tunnel URL to clipboard
          const copied = copyToClipboard(tunnel.url);
          const clipboardHint = copied ? chalk.gray(" (copied!)") : "";

          console.log(
            `  ${chalk.gray("Local:")}      ${chalk.cyan(`http://localhost:${port}`)}`,
          );
          console.log(
            `  ${chalk.gray("MCP:")}        ${chalk.cyan(`http://localhost:${port}/mcp`)}`,
          );
          console.log(
            `  ${chalk.gray("Public:")}     ${chalk.green(tunnel.url)}${clipboardHint}`,
          );
          console.log(
            `  ${chalk.gray("Public MCP:")} ${chalk.green(`${tunnel.url}/mcp`)}`,
          );

          // Show playground URL
          const playgroundUrl = getPlaygroundUrl(tunnel.url);
          console.log(
            `\n  ${chalk.gray("Playground:")} ${chalk.cyan(playgroundUrl)}`,
          );

          // Open playground if requested
          if (options.playground) {
            console.log(chalk.gray("\n  Opening playground in browser..."));
            openBrowser(playgroundUrl);
          } else {
            console.log(
              chalk.gray("\n  Use --playground flag to open in MCPize Playground"),
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`\n✖ Failed to create tunnel: ${message}`));
          console.log(chalk.gray("  Continuing without tunnel...\n"));
        }
      }

      console.log(chalk.gray("\n─────────────────────────────────────────\n"));
    }
  });
