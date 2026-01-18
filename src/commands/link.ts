import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";

const { prompt } = Enquirer;
import { getToken, getNewServerUrl } from "../lib/config.js";
import {
  listServers,
  findServerByRepo,
  type ServerInfo,
} from "../lib/api.js";
import { getGitInfo } from "../lib/git.js";
import {
  loadProjectConfig,
  saveProjectConfig,
} from "../lib/project.js";

export interface LinkOptions {
  server?: string;
  force?: boolean;
}

export async function linkCommand(options: LinkOptions): Promise<void> {
  const cwd = process.cwd();

  // Check authentication
  const token = getToken();
  if (!token) {
    console.error(chalk.red("Not authenticated. Run: mcpize login"));
    process.exit(1);
  }

  console.log(chalk.bold("\nMCPize Link\n"));

  // Check if already linked
  const existingConfig = loadProjectConfig(cwd);
  if (existingConfig?.serverId && !options.force) {
    console.log(chalk.yellow(`Already linked to: ${existingConfig.serverName || existingConfig.serverId}`));
    console.log(chalk.dim("Use --force to re-link to a different server.\n"));
    process.exit(0);
  }

  let serverId: string;
  let serverName: string | undefined;
  let serverBranch: string | undefined;

  // If server ID provided via option
  if (options.server) {
    serverId = options.server;
    console.log(chalk.dim(`Linking to server: ${serverId}`));
  } else {
    // Try to find by repo first
    const gitInfo = await getGitInfo(cwd);

    if (gitInfo?.repoFullName) {
      console.log(chalk.dim(`Repository: ${gitInfo.repoFullName}\n`));

      const spinner = ora("Checking for existing server...").start();
      try {
        const existingServer = await findServerByRepo(gitInfo.repoFullName);
        spinner.stop();

        if (existingServer) {
          console.log(chalk.green(`✓ Found server for this repository: ${existingServer.name}\n`));

          const response = await prompt<{ confirm: boolean }>({
            type: "confirm",
            name: "confirm",
            message: `Link to "${existingServer.name}"?`,
            initial: true,
          });

          if (response.confirm) {
            serverId = existingServer.id;
            serverName = existingServer.name;
            serverBranch = existingServer.branch;
          } else {
            // Fall through to manual selection
            const manualServer = await selectServer();
            if (!manualServer) process.exit(0);
            serverId = manualServer.id;
            serverName = manualServer.name;
            serverBranch = manualServer.branch;
          }
        } else {
          console.log(chalk.dim("No server found for this repository.\n"));
          const manualServer = await selectServer();
          if (!manualServer) process.exit(0);
          serverId = manualServer.id;
          serverName = manualServer.name;
          serverBranch = manualServer.branch;
        }
      } catch (error) {
        spinner.stop();
        const manualServer = await selectServer();
        if (!manualServer) process.exit(0);
        serverId = manualServer.id;
        serverName = manualServer.name;
        serverBranch = manualServer.branch;
      }
    } else {
      console.log(chalk.dim("Not a git repository or no remote configured.\n"));
      const manualServer = await selectServer();
      if (!manualServer) process.exit(0);
      serverId = manualServer.id;
      serverName = manualServer.name;
      serverBranch = manualServer.branch;
    }
  }

  // Save project config
  const projectConfig = {
    serverId,
    serverName,
    branch: serverBranch,
  };
  saveProjectConfig(cwd, projectConfig);

  console.log(chalk.green(`\n✓ Linked to ${serverName || serverId}`));
  console.log(chalk.dim("Saved to .mcpize/project.json"));
  console.log(chalk.dim("\nRun 'mcpize deploy' to deploy your server.\n"));
}

async function selectServer(): Promise<ServerInfo | null> {
  const spinner = ora("Fetching servers...").start();
  let servers: ServerInfo[];

  try {
    servers = await listServers();
    spinner.stop();
  } catch (error) {
    spinner.fail("Failed to fetch servers");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }

  if (servers.length === 0) {
    console.log(chalk.yellow("\nNo servers found."));
    console.log(chalk.dim("Create a server with: mcpize deploy"));
    console.log(chalk.dim(`Or create one at: ${getNewServerUrl()}\n`));
    return null;
  }

  const response = await prompt<{ server: string }>({
    type: "select",
    name: "server",
    message: "Select a server to link:",
    choices: [
      ...servers.map((s) => ({
        name: s.id,
        message: `${s.name} (${s.slug})${s.repo_full_name ? ` - ${s.repo_full_name}` : ""}`,
        value: s.id,
      })),
      {
        name: "cancel",
        message: "Cancel",
        value: "cancel",
      },
    ],
  });

  if (response.server === "cancel") {
    console.log(chalk.dim("\nLink cancelled."));
    return null;
  }

  return servers.find((s) => s.id === response.server) || null;
}
