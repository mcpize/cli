import { Command } from "commander";
import chalk from "chalk";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  inspector: boolean;
  build: boolean;
  tunnel: boolean;
  provider?: TunnelProviderType;
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
): { cmd: string; args: string[] } {
  // Check package.json for custom dev script
  if (runtime === "typescript") {
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
    return { cmd: "php", args: ["-S", "0.0.0.0:8080", "-t", "public"] };
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
 * Check if MCP Inspector is available
 */
async function checkInspector(): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(
      "npx",
      ["--yes", "@anthropic-ai/mcp-inspector", "--version"],
      {
        stdio: "ignore",
        shell: true,
      },
    );
    check.on("close", (code) => resolve(code === 0));
    check.on("error", () => resolve(false));
    // Timeout after 5 seconds
    setTimeout(() => {
      check.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Open MCP Inspector in browser
 */
function openInspector(port: number): void {
  const url = `https://inspect.mcpize.dev?url=http://localhost:${port}/mcp`;
  console.log(chalk.cyan(`\n🔍 MCP Inspector: ${url}`));

  // Try to open browser
  const openCmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(openCmd, [url], { stdio: "ignore", shell: true, detached: true });
}

export const devCommand = new Command("dev")
  .description("Run local development server with hot reload")
  .option("-p, --port <port>", "Port to run on", "3000")
  .option("--no-inspector", "Don't open MCP Inspector")
  .option("--no-build", "Skip initial build step")
  .option("-t, --tunnel", "Expose server via public tunnel URL")
  .option(
    "--provider <provider>",
    "Tunnel provider: localtunnel, ngrok, cloudflared",
  )
  .action(async (options: DevOptions) => {
    const cwd = process.cwd();
    const port = parseInt(options.port, 10);

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

    // 4. Run initial build for TypeScript
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

    // 5. Get dev command
    const { cmd, args } = getDevCommand(cwd, runtime);

    // 6. Prepare environment
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...envVars,
      PORT: String(port),
      NODE_ENV: "development",
    };

    // 7. Print URLs
    console.log(chalk.bold("\nStarting server...\n"));
    console.log(
      `  ${chalk.gray("Local:")}   ${chalk.cyan(`http://localhost:${port}`)}`,
    );
    console.log(
      `  ${chalk.gray("MCP:")}     ${chalk.cyan(`http://localhost:${port}/mcp`)}`,
    );

    // 8. Setup tunnel if requested
    let tunnel: TunnelConnection | null = null;
    if (options.tunnel) {
      try {
        tunnel = await createTunnel(port, options.provider as TunnelProviderType);
        console.log(
          `  ${chalk.gray("Public:")} ${chalk.green(tunnel.url)}`,
        );
        console.log(
          `  ${chalk.gray("MCP:")}    ${chalk.green(`${tunnel.url}/mcp`)}`,
        );
        console.log(
          chalk.gray("\n  Use the public URL in Claude Desktop config"),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`\n✖ Failed to create tunnel: ${message}`));
        console.log(chalk.gray("  Continuing without tunnel...\n"));
      }
    }

    console.log(chalk.gray(`\n  Health check: MCP ping method`));

    // 9. Open MCP Inspector
    if (options.inspector) {
      setTimeout(() => openInspector(port), 2000); // Wait for server to start
    }

    console.log(chalk.gray("\n─────────────────────────────────────────\n"));
    console.log(chalk.gray(`$ ${cmd} ${args.join(" ")}\n`));

    // 9. Spawn dev process
    const child: ChildProcess = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: true,
      env,
    });

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
  });
