import chalk from "chalk";
import ora from "ora";
import open from "open";
import { requireAuth } from "../lib/auth.js";
import { getSupabaseUrl } from "../lib/config.js";
import { findAvailablePort, createCallbackServer } from "../lib/callback-server.js";

interface OAuthConnection {
  id: string;
  provider: string;
  status: string;
  provider_user_id?: string;
  provider_user_email?: string;
  oauth_connection_servers?: unknown[];
}

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  slack: "Slack",
  figma: "Figma",
  facebook: "Meta",
  shopify: "Shopify",
  hubspot: "HubSpot",
};

export async function authStatusCommand(): Promise<void> {
  const token = await requireAuth();
  const supabaseUrl = getSupabaseUrl();

  const spinner = ora("Fetching connections...").start();

  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/oauth-connect/connections`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { connections?: OAuthConnection[] };
    const { connections } = body;

    spinner.stop();

    if (!connections || connections.length === 0) {
      console.log(chalk.dim("\nNo OAuth connections.\n"));
      console.log(chalk.dim("Connect a provider: mcpize auth connect <provider>"));
      return;
    }

    console.log(chalk.bold("\nOAuth Connections:\n"));

    for (const conn of connections) {
      const label = (PROVIDER_LABELS[conn.provider] || conn.provider).padEnd(12);
      const user = (conn.provider_user_id
        ? `@${conn.provider_user_id}`
        : conn.provider_user_email || ""
      ).padEnd(24);
      const serverCount = conn.oauth_connection_servers?.length || 0;
      const servers = `${serverCount} server${serverCount !== 1 ? "s" : ""}`;

      let statusText: string;
      if (conn.status === "connected") {
        statusText = chalk.green("Connected");
      } else if (conn.status === "expired") {
        statusText = chalk.yellow("Expired");
      } else {
        statusText = chalk.red("Revoked");
      }

      console.log(`  ${label} ${user} ${statusText.padEnd(20)} ${chalk.dim(servers)}`);
    }

    console.log();
  } catch (error) {
    spinner.fail(chalk.red("Failed to fetch connections"));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export async function authConnectCommand(provider: string): Promise<void> {
  const token = await requireAuth();
  const supabaseUrl = getSupabaseUrl();
  const providerLabel = PROVIDER_LABELS[provider] || provider;

  const port = await findAvailablePort();

  const { promise, server } = createCallbackServer(port, {
    successTitle: "Connected!",
    successSubtitle: `${providerLabel} is now connected. Head back to your terminal.`,
    successEmoji: "🔗",
  });

  const callbackUrl = `http://localhost:${port}/callback`;
  const authorizeUrl = `${supabaseUrl}/functions/v1/oauth-connect/authorize/${provider}?token=${token}&return_url=${encodeURIComponent(callbackUrl)}`;

  console.log(chalk.dim(`\nOpening browser to connect ${providerLabel}...`));
  console.log(chalk.dim(`If browser doesn't open, visit:\n${authorizeUrl}\n`));

  try {
    await open(authorizeUrl);
  } catch {
    console.log(chalk.yellow("Could not open browser automatically."));
    console.log(chalk.yellow(`Please open this URL manually:\n${authorizeUrl}\n`));
  }

  const spinner = ora(`Waiting for ${providerLabel} authorization...`).start();

  const timeoutMs = 5 * 60 * 1000;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Authorization timed out.")), timeoutMs);
  });

  try {
    await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);

    spinner.succeed(chalk.green(`${providerLabel} connected!`));
    console.log(chalk.dim("\nCheck status: mcpize auth status\n"));

    server.closeAllConnections();
    server.close();
    process.exit(0);
  } catch (error) {
    clearTimeout(timeoutId!);
    spinner.fail(chalk.red(`Failed to connect ${providerLabel}`));
    server.closeAllConnections();
    server.close();
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export async function authDisconnectCommand(provider: string): Promise<void> {
  const token = await requireAuth();
  const supabaseUrl = getSupabaseUrl();
  const providerLabel = PROVIDER_LABELS[provider] || provider;

  const spinner = ora(`Disconnecting ${providerLabel}...`).start();

  try {
    const listRes = await fetch(
      `${supabaseUrl}/functions/v1/oauth-connect/connections`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
    const listBody = await listRes.json() as { connections?: OAuthConnection[] };
    const { connections } = listBody;

    const conn = connections?.find((c) => c.provider === provider);
    if (!conn) {
      spinner.fail(chalk.yellow(`No ${providerLabel} connection found.`));
      return;
    }

    const deleteRes = await fetch(
      `${supabaseUrl}/functions/v1/oauth-connect/connections`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ connectionId: conn.id }),
      },
    );

    if (!deleteRes.ok) throw new Error(`HTTP ${deleteRes.status}`);

    const displayName = conn.provider_user_id
      ? `@${conn.provider_user_id}`
      : conn.provider_user_email || "";

    spinner.succeed(chalk.green(`Disconnected ${providerLabel}${displayName ? ` (${displayName})` : ""}`));
  } catch (error) {
    spinner.fail(chalk.red(`Failed to disconnect ${providerLabel}`));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
