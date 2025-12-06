import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";

const { prompt } = Enquirer;

import { getToken } from "../lib/config.js";
import { loadProjectConfig } from "../lib/project.js";
import { listServers, deleteServer, APIError } from "../lib/api.js";

export interface DeleteOptions {
  server?: string;
  force?: boolean;
}

export async function deleteCommand(options: DeleteOptions): Promise<void> {
  // Check authentication
  const token = getToken();
  if (!token) {
    console.error(chalk.red("Not authenticated. Run: mcpize login"));
    process.exit(1);
  }

  let serverId = options.server;
  let serverName: string | undefined;
  let serverSlug: string | undefined;

  // Try to get server from project config if not specified
  if (!serverId) {
    const projectConfig = loadProjectConfig(process.cwd());
    if (projectConfig?.serverId) {
      serverId = projectConfig.serverId;
    }
  }

  // If still no server, show interactive picker
  if (!serverId) {
    const spinner = ora("Loading servers...").start();

    try {
      const servers = await listServers();
      spinner.stop();

      if (servers.length === 0) {
        console.log(chalk.yellow("No servers found."));
        process.exit(0);
      }

      const response = await prompt<{ selected: string }>({
        type: "select",
        name: "selected",
        message: "Select server to delete:",
        choices: servers.map((s) => ({
          name: s.id,
          message: `${s.name} ${chalk.dim(`(${s.slug})`)}`,
          value: s.id,
        })),
      });

      const selectedServer = servers.find((s) => s.id === response.selected);
      if (!selectedServer) {
        console.error(chalk.red("Server not found."));
        process.exit(1);
      }

      serverId = selectedServer.id;
      serverSlug = selectedServer.slug;
      serverName = selectedServer.name;
    } catch (error) {
      spinner.stop();
      // User cancelled with Ctrl+C
      if ((error as Error).message?.includes("cancelled")) {
        process.exit(0);
      }
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  }

  // Get server info for confirmation if we don't have it
  if (!serverSlug || !serverName) {
    const spinner = ora("Loading server info...").start();
    try {
      const servers = await listServers();
      const server = servers.find((s) => s.id === serverId);
      spinner.stop();

      if (!server) {
        console.error(chalk.red("Server not found."));
        process.exit(1);
      }

      serverSlug = server.slug;
      serverName = server.name;
    } catch (error) {
      spinner.fail("Failed to load server info");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  }

  // Confirmation (unless --force)
  if (!options.force) {
    console.log();
    console.log(chalk.red.bold("  WARNING: This action is irreversible!"));
    console.log(
      chalk.dim(
        "  All plans, secrets, deployments, and analytics will be permanently deleted.",
      ),
    );
    console.log();

    try {
      const response = await prompt<{ confirmSlug: string }>({
        type: "input",
        name: "confirmSlug",
        message: `Type "${chalk.cyan(serverSlug)}" to confirm deletion:`,
      });

      if (response.confirmSlug !== serverSlug) {
        console.log(chalk.yellow("\nDeletion cancelled."));
        process.exit(0);
      }
    } catch {
      // User cancelled with Ctrl+C
      console.log(chalk.yellow("\nDeletion cancelled."));
      process.exit(0);
    }
  }

  // Delete the server
  const spinner = ora(`Deleting ${serverName}...`).start();

  try {
    const result = await deleteServer(serverId!);
    spinner.succeed(chalk.green(result.message));
  } catch (error) {
    spinner.fail("Failed to delete server");

    if (error instanceof APIError && error.body) {
      const body = error.body as {
        error?: string;
        action_required?: string;
        active_subscriptions?: number;
      };

      if (body.active_subscriptions) {
        console.error(
          chalk.red(
            `\nCannot delete: ${body.active_subscriptions} active subscription(s)`,
          ),
        );
        console.error(
          chalk.dim("Cancel all subscriptions first in the dashboard."),
        );
      } else if (body.error) {
        console.error(chalk.red(`\n${body.error}`));
        if (body.action_required) {
          console.error(chalk.dim(body.action_required));
        }
      }
    } else {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
    }

    process.exit(1);
  }
}
