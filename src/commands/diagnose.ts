import chalk from "chalk";
import ora from "ora";
import open from "open";
import { getToken, getWebAppUrl } from "../lib/config.js";
import { loadProjectConfig } from "../lib/project.js";
import { getServerStatus, withRetry, NetworkError } from "../lib/api.js";

export interface DiagnoseOptions {
  server?: string;
  deployment?: string;
}

function getServerId(options: DiagnoseOptions): string {
  if (options.server) {
    return options.server;
  }

  const projectConfig = loadProjectConfig(process.cwd());
  if (projectConfig?.serverId) {
    return projectConfig.serverId;
  }

  console.error(chalk.red("No server specified."));
  console.error(
    chalk.dim("Use --server <id> or run from a linked project directory."),
  );
  process.exit(1);
}

export async function diagnoseCommand(options: DiagnoseOptions): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error(chalk.red("Not authenticated. Run: mcpize login"));
    process.exit(1);
  }

  const serverId = getServerId(options);

  // If deployment ID is provided directly, open it
  if (options.deployment) {
    const url = `${getWebAppUrl()}/developer/servers/${serverId}/deployments/${options.deployment}/diagnose`;
    console.log(chalk.cyan("Opening deployment diagnosis..."));
    console.log(chalk.dim(url));
    await open(url);
    return;
  }

  // Otherwise, find the latest failed deployment
  const spinner = ora("Finding latest failed deployment...").start();

  try {
    const status = await withRetry(() => getServerStatus(serverId));
    const failedDeployment = status.deployments.find(
      (d) => d.status === "failed",
    );

    if (!failedDeployment) {
      spinner.succeed("No failed deployments found.");
      console.log(chalk.green("All recent deployments are healthy."));
      return;
    }

    spinner.succeed(
      `Found failed deployment ${chalk.dim(failedDeployment.id.slice(0, 8))}`,
    );

    if (failedDeployment.error_message) {
      console.log(chalk.dim(`  Error: ${failedDeployment.error_message}`));
    }

    const url = `${getWebAppUrl()}/developer/servers/${serverId}/deployments/${failedDeployment.id}/diagnose`;
    console.log(chalk.cyan("\nOpening AI diagnosis in browser..."));
    console.log(chalk.dim(url));
    await open(url);
  } catch (error) {
    spinner.fail("Failed to fetch server status");
    if (error instanceof NetworkError) {
      console.error(chalk.red(`Network error: ${error.message}`));
    } else {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
    }
    process.exit(1);
  }
}
