import chalk from "chalk";
import ora from "ora";
import { getToken } from "../lib/config.js";
import { loadProjectConfig } from "../lib/project.js";
import {
  listLogs,
  withRetry,
  NetworkError,
  type LogEntry,
  type LogsResponse,
} from "../lib/api.js";
import {
  getCache,
  getCacheStale,
  setCache,
  formatAge as formatCacheAge,
  CacheTTL,
  CacheKeys,
} from "../lib/cache.js";

export interface LogsOptions {
  server?: string;
  deployment?: string;
  type?: "build" | "runtime" | "bridge";
  severity?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  since?: string;
  tail?: number;
  follow?: boolean;
  json?: boolean;
  refresh?: boolean;
}

function getServerId(options: LogsOptions): string {
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

function formatSeverity(severity: string): string {
  switch (severity.toUpperCase()) {
    case "ERROR":
    case "CRITICAL":
    case "ALERT":
    case "EMERGENCY":
      return chalk.red.bold(severity.padEnd(8));
    case "WARNING":
      return chalk.yellow.bold(severity.padEnd(8));
    case "INFO":
    case "NOTICE":
      return chalk.blue(severity.padEnd(8));
    case "DEBUG":
      return chalk.dim(severity.padEnd(8));
    default:
      return severity.padEnd(8);
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return chalk.dim(
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
  );
}

function printLog(log: LogEntry): void {
  const time = formatTimestamp(log.timestamp);
  const severity = formatSeverity(log.severity);
  console.log(`${time} ${severity} ${log.message}`);
}

export async function logsCommand(options: LogsOptions): Promise<void> {
  requireAuth();
  const serverId = getServerId(options);
  const logType = options.type || "runtime";
  const cacheKey = CacheKeys.serverLogs(serverId, logType);

  // Follow mode - poll for new logs
  if (options.follow) {
    console.log(chalk.bold(`Following logs (${logType})...\n`));
    console.log(chalk.dim("Polling every 10s (Cloud Logging has ~30s delay)"));
    console.log(chalk.dim("Press Ctrl+C to stop\n"));

    let seenIds = new Set<string>();
    let isFirstPoll = true;

    const poll = async () => {
      try {
        const response = await listLogs(serverId, {
          deploymentId: options.deployment,
          type: logType,
          severity: options.severity,
          since: options.since || "5m",
          limit: 100,
        });

        if (response.logs && response.logs.length > 0) {
          // Filter out already seen logs and print new ones
          const newLogs = response.logs
            .filter((log) => !seenIds.has(log.insertId || log.timestamp))
            .reverse(); // oldest first

          if (newLogs.length > 0) {
            if (isFirstPoll) {
              console.log(chalk.dim(`─── ${newLogs.length} recent logs ───\n`));
            }

            for (const log of newLogs) {
              printLog(log);
              seenIds.add(log.insertId || log.timestamp);
            }
          }

          isFirstPoll = false;

          // Keep seenIds from growing too large
          if (seenIds.size > 500) {
            const arr = Array.from(seenIds);
            seenIds = new Set(arr.slice(-250));
          }
        } else if (isFirstPoll) {
          console.log(chalk.dim("No recent logs. Waiting for new logs..."));
          isFirstPoll = false;
        }
      } catch (error) {
        if (error instanceof NetworkError) {
          console.error(
            chalk.dim(
              `[${new Date().toLocaleTimeString()}] Network error, retrying...`,
            ),
          );
        }
      }
    };

    // Initial fetch
    await poll();

    // Poll every 10 seconds
    const interval = setInterval(poll, 10000);

    // Handle Ctrl+C
    process.on("SIGINT", () => {
      clearInterval(interval);
      console.log(chalk.dim("\n\nStopped following logs."));
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {}); // Never resolves
    return;
  }

  // Try to get from cache first (unless --refresh)
  let response: LogsResponse | null = null;
  let fromCache = false;
  let cacheAge = 0;

  if (!options.refresh) {
    const cached = getCache<LogsResponse>(cacheKey);
    if (cached) {
      response = cached.data;
      fromCache = true;
      cacheAge = cached.age;
    }
  }

  // Fetch from API if no cache or refresh requested
  if (!response) {
    const spinner = ora("Fetching logs from Cloud Logging...").start();

    try {
      response = await withRetry(
        () =>
          listLogs(serverId, {
            deploymentId: options.deployment,
            type: logType,
            severity: options.severity,
            since: options.since,
            limit: options.tail || 50,
          }),
        {
          onRetry: (attempt, delay) => {
            spinner.text = `Retrying... (attempt ${attempt + 1}/3, waiting ${delay / 1000}s)`;
          },
        },
      );
      spinner.stop();

      // Save to cache
      setCache(cacheKey, response, CacheTTL.LOGS);
      fromCache = false;
    } catch (error) {
      spinner.stop();

      // Try stale cache as fallback
      const staleCache = getCacheStale<LogsResponse>(cacheKey);
      if (staleCache) {
        console.log(
          chalk.yellow(
            `\n⚠ Cannot connect to MCPize API (showing cached logs from ${formatCacheAge(staleCache.age)})\n`,
          ),
        );
        response = staleCache.data;
        fromCache = true;
        cacheAge = staleCache.age;
      } else {
        // No cache available, show error
        if (error instanceof NetworkError) {
          console.error(chalk.red(`\n✗ ${error.message}`));
          console.error(
            chalk.dim("Run 'mcpize logs --refresh' when online to update"),
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

  // Check if there was an error fetching logs
  if (response.message) {
    console.log(chalk.yellow(response.message));
    if (response.error_code) {
      console.log(chalk.dim(`Error code: ${response.error_code}`));
    }
    return;
  }

  if (response.logs.length === 0) {
    console.log(chalk.dim("No logs found."));

    if (options.since) {
      console.log(
        chalk.dim(
          `Try a longer time range (current: --since ${options.since})`,
        ),
      );
    }
    return;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        { ...response, _cached: fromCache, _cacheAge: cacheAge },
        null,
        2,
      ),
    );
    return;
  }

  // Print header
  const filters: string[] = [];
  if (options.deployment)
    filters.push(`deployment: ${options.deployment.slice(0, 8)}`);
  if (options.type) filters.push(`type: ${options.type}`);
  if (options.severity) filters.push(`severity: ${options.severity}+`);
  if (options.since) filters.push(`since: ${options.since}`);

  // Show cached indicator
  if (fromCache && cacheAge > 0) {
    console.log(chalk.dim(`(cached ${formatCacheAge(cacheAge)})`));
  }

  console.log(chalk.bold(`Logs from Cloud Logging (${logType}):\n`));

  if (filters.length > 0) {
    console.log(chalk.dim(`Filters: ${filters.join(", ")}\n`));
  }

  // Print logs (reverse to show oldest first)
  const logsToShow = [...response.logs].reverse();
  for (const log of logsToShow) {
    printLog(log);
  }

  console.log();
  console.log(chalk.dim(`Showing ${response.logs.length} log entries`));

  if (response.nextPageToken) {
    console.log(chalk.dim(`More logs available (use --tail for more)`));
  }

  if (fromCache) {
    console.log(chalk.dim("\nRun 'mcpize logs --refresh' to update"));
  }
}
