import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";
import { getToken } from "../lib/config.js";
import { loadProjectConfig } from "../lib/project.js";
import {
  getServerStatus,
  rollbackDeployment,
  withRetry,
  type DeploymentInfo,
} from "../lib/api.js";

export interface RollbackOptions {
  server?: string;
  to?: string;
  steps?: number;
  reason?: string;
  yes?: boolean;
}

function getServerId(options: RollbackOptions): string {
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

function requireAuth(): void {
  const token = getToken();
  if (!token) {
    console.error(chalk.red("Not authenticated. Run: mcpize login"));
    process.exit(1);
  }
}

function formatDeployment(d: DeploymentInfo, isCurrent: boolean): string {
  const status = d.status === "success" ? chalk.green("✓") : chalk.red("✗");
  const sha = d.git_sha ? d.git_sha.slice(0, 7) : "n/a";
  const branch = d.git_branch || "n/a";
  const age = formatAge(d.created_at);
  const current = isCurrent ? chalk.yellow(" (current)") : "";

  return `${status} ${chalk.bold(d.id.slice(0, 8))}  ${sha}  ${branch.padEnd(12)}  ${age}${current}`;
}

function formatAge(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export const rollbackCommand = new Command("rollback")
  .description("Rollback to a previous deployment")
  .option("--server <id>", "Server ID (uses linked project if not specified)")
  .option("--to <deployment_id>", "Rollback to specific deployment ID")
  .option(
    "--steps <n>",
    "Rollback N deployments back (default: 1)",
    (v) => parseInt(v, 10),
    1,
  )
  .option("--reason <reason>", "Reason for rollback")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options: RollbackOptions) => {
    requireAuth();
    const serverId = getServerId(options);

    console.log(chalk.bold("\nMCPize Rollback\n"));

    // Get current deployments
    const statusSpinner = ora("Fetching deployment history...").start();

    let serverStatus;
    try {
      serverStatus = await withRetry(() => getServerStatus(serverId));
      statusSpinner.stop();
    } catch (error) {
      statusSpinner.stop();
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }

    const deployments = serverStatus.deployments || [];
    const successfulDeployments = deployments.filter(
      (d) => d.status === "success",
    );

    if (successfulDeployments.length < 2) {
      console.error(
        chalk.red("Not enough successful deployments to rollback."),
      );
      console.error(chalk.dim("You need at least 2 successful deployments."));
      process.exit(1);
    }

    const currentDeployment = successfulDeployments[0];
    let targetDeployment: DeploymentInfo;

    if (options.to) {
      // Find specific deployment
      const found = successfulDeployments.find(
        (d) => d.id === options.to || d.id.startsWith(options.to!),
      );
      if (!found) {
        console.error(chalk.red(`Deployment ${options.to} not found.`));
        console.error(chalk.dim("Available deployments:"));
        for (const d of successfulDeployments.slice(0, 5)) {
          console.error(
            chalk.dim(
              `  ${d.id.slice(0, 8)} - ${d.git_sha?.slice(0, 7) || "n/a"}`,
            ),
          );
        }
        process.exit(1);
      }
      targetDeployment = found;
    } else {
      // Use --steps (default: 1)
      const steps = options.steps || 1;
      if (steps >= successfulDeployments.length) {
        console.error(
          chalk.red(
            `Cannot rollback ${steps} step(s). Only ${successfulDeployments.length - 1} previous deployment(s) available.`,
          ),
        );
        process.exit(1);
      }
      targetDeployment = successfulDeployments[steps];
    }

    if (targetDeployment.id === currentDeployment.id) {
      console.error(
        chalk.red("Target deployment is already the current deployment."),
      );
      process.exit(1);
    }

    // Show rollback info
    console.log(chalk.dim("Current deployment:"));
    console.log(`  ${formatDeployment(currentDeployment, true)}\n`);

    console.log(chalk.dim("Rollback to:"));
    console.log(`  ${formatDeployment(targetDeployment, false)}\n`);

    // Confirm unless --yes
    if (!options.yes) {
      const enquirer = new Enquirer();
      try {
        const response = await enquirer.prompt({
          type: "confirm",
          name: "confirm",
          message: `Rollback to deployment ${targetDeployment.id.slice(0, 8)}?`,
        });
        if (!(response as { confirm: boolean }).confirm) {
          console.log(chalk.dim("\nRollback cancelled."));
          process.exit(0);
        }
      } catch {
        console.log(chalk.dim("\nRollback cancelled."));
        process.exit(0);
      }
    }

    // Execute rollback
    const rollbackSpinner = ora("Rolling back...").start();

    try {
      const result = await withRetry(() =>
        rollbackDeployment(serverId, {
          targetDeploymentId: targetDeployment.id,
          reason: options.reason,
        }),
      );

      rollbackSpinner.succeed("Rollback complete!");

      console.log();
      console.log(chalk.green("✓ Deployment rolled back successfully"));
      console.log();
      console.log(
        `  ${chalk.dim("From:")} ${currentDeployment.id.slice(0, 8)}`,
      );
      console.log(`  ${chalk.dim("To:")}   ${targetDeployment.id.slice(0, 8)}`);
      console.log(
        `  ${chalk.dim("New deployment:")} ${result.deployment_id.slice(0, 8)}`,
      );

      console.log();
      console.log(chalk.dim("Run 'mcpize status' to verify the rollback."));
    } catch (error) {
      rollbackSpinner.fail("Rollback failed");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });
