import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";
import path from "node:path";

const { prompt } = Enquirer;
import { getToken } from "../lib/config.js";
import {
  uploadTarball,
  triggerDeploy,
  getDeploymentStatus,
  listServers,
  findServerByRepo,
  createServer,
  type ServerInfo,
} from "../lib/api.js";
import { createTarball, formatBytes } from "../lib/tarball.js";
import { getGitInfo } from "../lib/git.js";
import {
  loadProjectConfig,
  saveProjectConfig,
  hasManifest,
  loadManifest,
  loadPackageJson,
} from "../lib/project.js";

export interface DeployOptions {
  wait?: boolean;
  noWait?: boolean;
  notes?: string;
  yes?: boolean;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function deployCommand(options: DeployOptions): Promise<void> {
  const cwd = process.cwd();

  // Check authentication
  const token = getToken();
  if (!token) {
    console.error(chalk.red("Not authenticated. Run: mcpize login"));
    process.exit(1);
  }

  // Check for mcpize.yaml
  if (!hasManifest(cwd)) {
    console.error(chalk.red("No mcpize.yaml found in current directory."));
    console.error(chalk.dim("Create one with: mcpize init"));
    process.exit(1);
  }

  const manifest = loadManifest(cwd);
  console.log(chalk.bold("\nMCPize Deploy\n"));
  console.log(chalk.dim(`Runtime: ${manifest?.runtime || "unknown"}`));

  // Get git info first (needed for auto-create)
  const gitInfo = await getGitInfo(cwd);

  // Get or create server
  let projectConfig = loadProjectConfig(cwd);
  let serverId = "";
  let serverName: string | undefined;

  if (projectConfig?.serverId) {
    // Already linked to a server
    serverId = projectConfig.serverId;
    serverName = projectConfig.serverName;
    console.log(chalk.dim(`Server: ${serverName || serverId}`));
  } else {
    // Need to find or create a server
    console.log(chalk.yellow("Project not linked to a server.\n"));

    let existingServer: ServerInfo | null = null;

    // Try to find server by git repo
    if (gitInfo?.repoFullName) {
      const spinner = ora("Checking for existing server...").start();
      try {
        existingServer = await findServerByRepo(gitInfo.repoFullName);
        spinner.stop();

        if (existingServer) {
          console.log(
            chalk.green(`✓ Found existing server: ${existingServer.name}`),
          );
          serverId = existingServer.id;
          serverName = existingServer.name;

          // Save project config
          projectConfig = {
            serverId,
            serverName,
            branch: existingServer.branch,
          };
          saveProjectConfig(cwd, projectConfig);
          console.log(chalk.dim(`Linked to .mcpize/project.json\n`));
        }
      } catch (error) {
        spinner.stop();
        // Continue to create new server
      }
    }

    if (!existingServer) {
      // No existing server found - offer to create or select
      // Priority chain: mcpize.yaml name → package.json name → git repo name → directory name
      const packageJson = loadPackageJson(cwd);
      const defaultName =
        manifest?.name ||
        packageJson?.name ||
        gitInfo?.repoFullName?.split("/")[1] ||
        path.basename(cwd);

      let action: string;
      let serverNameToCreate = defaultName;

      if (options.yes) {
        // Auto-create with default name
        action = "create";
        console.log(chalk.dim(`Auto-creating server "${defaultName}"...\n`));
      } else {
        const response = await prompt<{ action: string }>({
          type: "select",
          name: "action",
          message: "No server found. What would you like to do?",
          choices: [
            {
              name: "create",
              message: `Create new server "${defaultName}"`,
            },
            {
              name: "select",
              message: "Link to existing server",
            },
            {
              name: "cancel",
              message: "Cancel deployment",
            },
          ],
        });
        action = response.action;

        if (action === "cancel") {
          console.log(chalk.dim("\nDeployment cancelled."));
          process.exit(0);
        }

        if (action === "create") {
          const nameResponse = await prompt<{ name: string }>({
            type: "input",
            name: "name",
            message: "Server name:",
            initial: defaultName,
          });
          serverNameToCreate = nameResponse.name;
        }
      }

      if (action === "create") {
        const spinner = ora("Creating server...").start();

        try {
          // Priority chain: mcpize.yaml description → package.json description
          const description = manifest?.description || packageJson?.description;

          const newServer = await createServer({
            name: serverNameToCreate,
            slug: slugify(serverNameToCreate),
            description,
            repo_full_name: gitInfo?.repoFullName,
            branch: gitInfo?.branch || "main",
          });

          spinner.succeed(`Created server: ${newServer.name}`);
          serverId = newServer.id;
          serverName = newServer.name;

          // Save project config
          projectConfig = {
            serverId,
            serverName,
            branch: newServer.branch,
          };
          saveProjectConfig(cwd, projectConfig);
          console.log(chalk.dim(`Saved to .mcpize/project.json\n`));
        } catch (error) {
          spinner.fail("Failed to create server");
          console.error(
            chalk.red(error instanceof Error ? error.message : String(error)),
          );
          process.exit(1);
        }
      } else if (action === "select") {
        // Select existing server
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
          console.log(
            chalk.yellow("\nNo servers found. Creating a new one...\n"),
          );

          const nameResponse = await prompt<{ name: string }>({
            type: "input",
            name: "name",
            message: "Server name:",
            initial: defaultName,
          });

          const createSpinner = ora("Creating server...").start();

          try {
            // Priority chain: mcpize.yaml description → package.json description
            const description =
              manifest?.description || packageJson?.description;

            const newServer = await createServer({
              name: nameResponse.name,
              slug: slugify(nameResponse.name),
              description,
              repo_full_name: gitInfo?.repoFullName,
              branch: gitInfo?.branch || "main",
            });

            createSpinner.succeed(`Created server: ${newServer.name}`);
            serverId = newServer.id;
            serverName = newServer.name;

            projectConfig = {
              serverId,
              serverName,
              branch: newServer.branch,
            };
            saveProjectConfig(cwd, projectConfig);
            console.log(chalk.dim(`Saved to .mcpize/project.json\n`));
          } catch (error) {
            createSpinner.fail("Failed to create server");
            console.error(
              chalk.red(error instanceof Error ? error.message : String(error)),
            );
            process.exit(1);
          }
        } else {
          const selectResponse = await prompt<{ server: string }>({
            type: "select",
            name: "server",
            message: "Select a server to deploy to:",
            choices: servers.map((s) => ({
              name: s.id,
              message: `${s.name} (${s.slug})${s.repo_full_name ? ` - ${s.repo_full_name}` : ""}`,
              value: s.id,
            })),
          });

          serverId = selectResponse.server;
          const selectedServer = servers.find((s) => s.id === serverId);
          serverName = selectedServer?.name;

          // Save project config
          projectConfig = {
            serverId,
            serverName,
            branch: selectedServer?.branch,
          };
          saveProjectConfig(cwd, projectConfig);
          console.log(chalk.green(`\n✓ Linked to ${serverName}`));
          console.log(chalk.dim(`Saved to .mcpize/project.json\n`));
        }
      }
    }
  }

  // Show git info
  if (gitInfo) {
    console.log(chalk.dim(`Branch: ${gitInfo.branch}`));
    console.log(chalk.dim(`Commit: ${gitInfo.sha} - ${gitInfo.message}`));
  }
  console.log();

  // Create tarball
  const tarballSpinner = ora("Creating tarball...").start();
  let tarballBuffer: Buffer;

  try {
    tarballBuffer = await createTarball({ cwd });
    tarballSpinner.succeed(
      `Tarball created (${formatBytes(tarballBuffer.length)})`,
    );
  } catch (error) {
    tarballSpinner.fail("Failed to create tarball");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }

  // Check size limit (100MB)
  const MAX_SIZE = 100 * 1024 * 1024;
  if (tarballBuffer.length > MAX_SIZE) {
    console.error(
      chalk.red(`\nTarball too large: ${formatBytes(tarballBuffer.length)}`),
    );
    console.error(chalk.red(`Maximum allowed: ${formatBytes(MAX_SIZE)}`));
    console.error(
      chalk.dim("\nTip: Check .mcpizeignore to exclude large files"),
    );
    process.exit(1);
  }

  // Upload tarball
  const uploadSpinner = ora("Uploading to MCPize...").start();
  let uploadId: string;

  try {
    const uploadResult = await uploadTarball(
      serverId,
      tarballBuffer,
      gitInfo?.sha,
    );
    uploadId = uploadResult.upload_id;
    uploadSpinner.succeed("Uploaded successfully");
  } catch (error) {
    uploadSpinner.fail("Upload failed");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }

  // Trigger deploy
  const deploySpinner = ora("Triggering deployment...").start();

  try {
    const deployResult = await triggerDeploy(serverId, uploadId, {
      gitSha: gitInfo?.sha,
      gitBranch: gitInfo?.branch,
      gitAuthor: gitInfo?.author,
      gitMessage: gitInfo?.message,
      notes: options.notes,
    });

    deploySpinner.succeed("Deployment triggered");

    console.log(chalk.bold.green("\n✓ Deployment started!\n"));
    console.log(chalk.dim(`Deployment ID: ${deployResult.deployment_id}`));
    console.log(chalk.dim(`Status: ${deployResult.status}`));
    console.log(chalk.dim(`Dashboard: ${deployResult.dashboard_url}`));

    // Wait for deployment by default, unless --no-wait is specified
    const shouldWait = !options.noWait;

    if (shouldWait) {
      console.log(chalk.dim("\nWaiting for deployment to complete...\n"));

      const waitSpinner = ora("Building...").start();
      const deploymentId = deployResult.deployment_id;
      let lastStatus = "";

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10s

        try {
          const status = await getDeploymentStatus(deploymentId);

          if (status.status !== lastStatus) {
            lastStatus = status.status;

            if (status.status === "building") {
              waitSpinner.text = "Building Docker image...";
            } else if (status.status === "deploying") {
              waitSpinner.text = "Deploying to Cloud Run...";
            }
          }

          if (status.status === "success") {
            waitSpinner.succeed("Deployment complete!");
            console.log(chalk.bold.green(`\n✓ Server is live!\n`));
            if (status.service_url) {
              console.log(chalk.cyan(`URL: ${status.service_url}`));
            }
            break;
          } else if (status.status === "failed") {
            waitSpinner.fail("Deployment failed");
            if (status.error) {
              console.error(chalk.red(`\nError: ${status.error}`));
            }
            console.log(chalk.dim(`\nCheck logs: mcpize logs --build`));
            process.exit(1);
          }
        } catch (error) {
          // Continue polling on network errors
          console.error(
            chalk.dim(
              `\nPolling error: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }
    }

    console.log();
  } catch (error) {
    deploySpinner.fail("Deployment failed");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
