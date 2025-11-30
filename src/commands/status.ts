import chalk from "chalk";
import ora from "ora";
import { getToken } from "../lib/config.js";
import { loadProjectConfig } from "../lib/project.js";
import {
  getServerStatus,
  withRetry,
  NetworkError,
  type DeploymentInfo,
  type ServerStatusResponse,
} from "../lib/api.js";
import {
  getCache,
  getCacheStale,
  setCache,
  formatAge as formatCacheAge,
  CacheTTL,
  CacheKeys,
} from "../lib/cache.js";

export interface StatusOptions {
  server?: string;
  json?: boolean;
  refresh?: boolean;
}

function getServerId(options: StatusOptions): string {
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

function formatStatus(status: string): string {
  switch (status) {
    case "success":
      return chalk.green("success");
    case "failed":
      return chalk.red("failed");
    case "building":
      return chalk.yellow("building");
    case "deploying":
      return chalk.cyan("deploying");
    case "pending":
      return chalk.dim("pending");
    default:
      return status;
  }
}

function formatHealthStatus(status: string | null): string {
  if (!status) return chalk.dim("unknown");
  switch (status) {
    case "healthy":
      return chalk.green("healthy");
    case "unhealthy":
      return chalk.red("unhealthy");
    case "unknown":
      return chalk.dim("unknown");
    default:
      return status;
  }
}

function formatAge(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  } else if (diffHours > 0) {
    return `${diffHours}h ago`;
  } else if (diffMins > 0) {
    return `${diffMins}m ago`;
  } else {
    return "just now";
  }
}

function formatDeployment(dep: DeploymentInfo, index: number): void {
  const sha = dep.git_sha ? dep.git_sha.slice(0, 7) : chalk.dim("n/a");
  const branch = dep.git_branch || chalk.dim("n/a");
  const status = formatStatus(dep.status);
  const age = formatAge(dep.created_at);
  const author = dep.git_author || chalk.dim("unknown");

  const prefix = index === 0 ? chalk.cyan("*") : " ";
  console.log(
    `${prefix} ${sha}  ${branch.padEnd(15)}  ${status.padEnd(18)}  ${age.padEnd(10)}  ${author}`,
  );

  if (dep.git_message) {
    console.log(`    ${chalk.dim(dep.git_message.slice(0, 60))}`);
  }

  if (dep.status === "failed" && dep.error_message) {
    console.log(`    ${chalk.red(dep.error_message.slice(0, 80))}`);
  }
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  requireAuth();
  const serverId = getServerId(options);
  const cacheKey = CacheKeys.serverStatus(serverId);

  // Try to get from cache first (unless --refresh)
  let status: ServerStatusResponse | null = null;
  let fromCache = false;
  let cacheAge = 0;

  if (!options.refresh) {
    const cached = getCache<ServerStatusResponse>(cacheKey);
    if (cached) {
      status = cached.data;
      fromCache = true;
      cacheAge = cached.age;
    }
  }

  // Fetch from API if no cache or refresh requested
  if (!status) {
    const spinner = ora("Fetching server status...").start();

    try {
      status = await withRetry(() => getServerStatus(serverId), {
        onRetry: (attempt, delay) => {
          spinner.text = `Retrying... (attempt ${attempt + 1}/3, waiting ${delay / 1000}s)`;
        },
      });
      spinner.stop();

      // Save to cache
      setCache(cacheKey, status, CacheTTL.STATUS);
      fromCache = false;
    } catch (error) {
      spinner.stop();

      // Try stale cache as fallback
      const staleCache = getCacheStale<ServerStatusResponse>(cacheKey);
      if (staleCache) {
        console.log(
          chalk.yellow(
            `\n⚠ Cannot connect to MCPize API (showing cached data from ${formatCacheAge(staleCache.age)})\n`,
          ),
        );
        status = staleCache.data;
        fromCache = true;
        cacheAge = staleCache.age;
      } else {
        // No cache available, show error
        if (error instanceof NetworkError) {
          console.error(chalk.red(`\n✗ ${error.message}`));
          console.error(
            chalk.dim("Run 'mcpize status --refresh' when online to update"),
          );
        } else {
          console.error(
            chalk.red(error instanceof Error ? error.message : String(error)),
          );
        }
        process.exit(1);
      }
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        { ...status, _cached: fromCache, _cacheAge: cacheAge },
        null,
        2,
      ),
    );
    return;
  }

  const { server, deployments, stats } = status;

  // Show cached indicator if applicable
  if (fromCache && cacheAge > 0) {
    console.log(chalk.dim(`(cached ${formatCacheAge(cacheAge)})`));
  }

  // Server info
  console.log(chalk.bold(`\n${server.name}`));
  console.log(chalk.dim(`ID: ${server.id}`));
  console.log(chalk.dim(`Slug: ${server.slug}`));
  console.log();

  // Status line
  console.log(`Status: ${formatStatus(server.status)}`);
  console.log(`Health: ${formatHealthStatus(server.health_status)}`);
  if (server.hosting_url) {
    console.log(`URL: ${chalk.cyan(server.hosting_url)}`);
  }
  console.log();

  // Stats
  console.log(chalk.bold("Stats:"));
  console.log(
    `  Deployments: ${stats.total_deployments} total, ${chalk.green(stats.successful_deployments + " success")}, ${chalk.red(stats.failed_deployments + " failed")}`,
  );
  console.log(`  Secrets: ${stats.secrets_count} configured`);
  console.log();

  // Deployments
  if (deployments.length === 0) {
    console.log(chalk.dim("No deployments yet."));
  } else {
    console.log(chalk.bold("Recent Deployments:"));
    console.log(
      chalk.dim(
        "  SHA      Branch           Status              Age         Author",
      ),
    );
    console.log(chalk.dim("  " + "-".repeat(70)));

    for (let i = 0; i < deployments.length; i++) {
      formatDeployment(deployments[i], i);
    }
  }

  console.log();

  if (fromCache) {
    console.log(chalk.dim("Run 'mcpize status --refresh' to update"));
  }
}
