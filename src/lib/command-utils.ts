import chalk from "chalk";
import { loadProjectConfig } from "./project.js";

/**
 * Resolve server ID from --server flag or .mcpize/project.json.
 * Exits with error if neither is available.
 */
export function resolveServerId(options: { server?: string }): string {
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
