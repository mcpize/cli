#!/usr/bin/env node

// Suppress dotenv v17 verbose logging
process.env.DOTENV_CONFIG_QUIET = "true";

import { config } from "dotenv";
// Load .env from current directory (for local development)
config();

import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);
const version = pkg.version;
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { deployCommand } from "./commands/deploy.js";
import { linkCommand } from "./commands/link.js";
import { initCommand } from "./commands/init.js";
import {
  secretsListCommand,
  secretsSetCommand,
  secretsDeleteCommand,
  secretsExportCommand,
  secretsImportCommand,
} from "./commands/secrets.js";
import { logsCommand } from "./commands/logs.js";
import { statusCommand } from "./commands/status.js";
import { doctorCommand } from "./commands/doctor.js";
import { devCommand } from "./commands/dev.js";
import { rollbackCommand } from "./commands/rollback.js";
import { deleteCommand } from "./commands/delete.js";
import { analyzeCommand } from "./commands/analyze.js";
import { tokenCommand } from "./commands/token.js";
import { setTokenOverride } from "./lib/auth.js";

const program = new Command();

program
  .name("mcpize")
  .description("MCPize CLI - Deploy MCP servers to the cloud")
  .version(version)
  .option(
    "--token <token>",
    "API token (overrides MCPIZE_TOKEN env and saved session)",
  )
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.token) {
      setTokenOverride(opts.token);
    }
  });

program
  .command("init [name]")
  .description("Create a new MCP server project")
  .option(
    "-t, --template <template>",
    "Template to use (e.g., typescript, openapi)",
  )
  .option("--dir <path>", "Target directory")
  .option("--no-install", "Skip dependency installation")
  .option("--no-git", "Skip git initialization")
  // Template-specific options (passed to post-init script via env)
  .option("--from-url <url>", "OpenAPI spec URL to generate from")
  .option("--from-file <path>", "Local OpenAPI spec file to generate from")
  .allowUnknownOption(true) // Allow any options for future templates
  .action(async (name, options) => {
    try {
      await initCommand(name, options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Analyze current project and generate mcpize.yaml")
  .option("--force", "Overwrite existing mcpize.yaml")
  .option("--dry-run", "Preview without saving")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options) => {
    try {
      await analyzeCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("login")
  .description("Authenticate with MCPize via browser")
  .option("--email", "Use email/password instead of browser")
  .action(async (options) => {
    try {
      await loginCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Log out from MCPize")
  .action(async () => {
    try {
      await logoutCommand();
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("deploy")
  .description("Deploy current project to MCPize")
  .option(
    "--no-wait",
    "Don't wait for deployment to complete (just trigger and exit)",
  )
  .option("--notes <notes>", "Add deployment notes")
  .option("-y, --yes", "Auto-create server if not linked (non-interactive)")
  .action(async (options) => {
    try {
      await deployCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program
  .command("whoami")
  .description("Display current authenticated user")
  .action(async () => {
    const { getValidToken } = await import("./lib/auth.js");
    const { getCurrentUser } = await import("./lib/api.js");

    // Use getValidToken which handles auto-refresh
    const token = await getValidToken();

    if (!token) {
      console.log(chalk.yellow("Not logged in. Run: mcpize login"));
      process.exit(1);
    }

    try {
      const user = await getCurrentUser();
      console.log(chalk.green("Authenticated"));
      console.log(`Email: ${user.email}`);
      console.log(chalk.dim(`User ID: ${user.id}`));
    } catch (error) {
      console.log(chalk.red("Token is invalid or expired"));
      console.log(chalk.dim("Run: mcpize login"));
      process.exit(1);
    }
  });

program
  .command("link")
  .description("Link current directory to an existing MCPize server")
  .option("--server <id>", "Server ID to link to")
  .option("--force", "Force re-link even if already linked")
  .action(async (options) => {
    try {
      await linkCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

// Secrets command group
const secrets = program
  .command("secrets")
  .description("Manage environment secrets");

secrets
  .command("list")
  .description("List all secrets (names only)")
  .option(
    "-e, --environment <env>",
    "Environment (production, staging, preview)",
    "production",
  )
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .action(async (options) => {
    try {
      await secretsListCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

secrets
  .command("set <name> [value]")
  .description("Set a secret (value can be piped or entered interactively)")
  .option(
    "-e, --environment <env>",
    "Environment (production, staging, preview)",
    "production",
  )
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .option("--required", "Mark secret as required for deployment")
  .option("--from-file <path>", "Read secret value from file")
  .action(async (name, value, options) => {
    try {
      await secretsSetCommand(name, value, options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

secrets
  .command("delete <name>")
  .alias("rm")
  .description("Delete a secret")
  .option(
    "-e, --environment <env>",
    "Environment (production, staging, preview)",
    "production",
  )
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .action(async (name, options) => {
    try {
      await secretsDeleteCommand(name, options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

secrets
  .command("export")
  .description("Export secrets with values (use with caution)")
  .option(
    "-e, --environment <env>",
    "Environment (production, staging, preview)",
    "production",
  )
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .option("-f, --format <format>", "Output format: env, json", "env")
  .action(async (options) => {
    try {
      await secretsExportCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

secrets
  .command("import <file>")
  .description("Import secrets from a .env file")
  .option(
    "-e, --environment <env>",
    "Environment (production, staging, preview)",
    "production",
  )
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .option("--dry-run", "Preview secrets without importing")
  .action(async (file, options) => {
    try {
      await secretsImportCommand(file, options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

// Logs command (proxies to Google Cloud Logging)
program
  .command("logs")
  .description("View deployment and runtime logs from Cloud Logging")
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .option("-d, --deployment <id>", "Filter by deployment ID")
  .option("-t, --type <type>", "Log type: build, runtime, bridge", "runtime")
  .option(
    "-s, --severity <level>",
    "Minimum severity: DEBUG, INFO, WARNING, ERROR",
  )
  .option("--since <duration>", "Show logs since (e.g., 1h, 30m, 24h)")
  .option("-n, --tail <lines>", "Number of lines to show", "50")
  .option("-f, --follow", "Follow log output (polls every 10s)")
  .option("--json", "Output in JSON format")
  .option("--refresh", "Force refresh from API (ignore cache)")
  .action(async (options) => {
    try {
      await logsCommand({
        ...options,
        severity: options.severity?.toUpperCase(),
        tail: options.tail ? parseInt(options.tail, 10) : 50,
      });
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

// Status command
program
  .command("status")
  .description("Show server status, deployments, and usage stats")
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .option("--json", "Output in JSON format")
  .option("--refresh", "Force refresh from API (ignore cache)")
  .action(async (options) => {
    try {
      await statusCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

// Doctor command
program
  .command("doctor")
  .description("Run local diagnostics and pre-deploy validation")
  .option("--manifest", "Check mcpize.yaml only")
  .option("--dockerfile", "Check Dockerfile only")
  .option("--fix", "Attempt automatic fixes (not yet implemented)")
  .action(async (options) => {
    try {
      await doctorCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

// Dev command
program.addCommand(devCommand);

// Rollback command
program.addCommand(rollbackCommand);

// Token management command
program.addCommand(tokenCommand);

// Delete command
program
  .command("delete")
  .description("Delete an MCP server permanently")
  .option("--server <id>", "Server ID to delete")
  .option("-f, --force", "Skip confirmation prompt (requires --server)")
  .action(async (options) => {
    try {
      await deleteCommand(options);
    } catch (error) {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
