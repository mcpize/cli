import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getToken } from "../lib/config.js";
import {
  listCliTokens,
  createCliToken,
  deleteCliToken,
  type CliTokenInfo,
} from "../lib/api.js";

function requireAuth(): void {
  const token = getToken();
  if (!token) {
    console.error(chalk.red("Not authenticated. Run: mcpize login"));
    process.exit(1);
  }
}

function formatDate(dateString: string | null): string {
  if (!dateString) return chalk.dim("Never");
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return diffMins <= 1 ? "just now" : `${diffMins} minutes ago`;
    }
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

function formatExpiry(dateString: string | null): string {
  if (!dateString) return chalk.green("Never");
  const date = new Date(dateString);
  const now = new Date();
  if (date < now) return chalk.red("Expired");
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return chalk.yellow(`${diffDays} day${diffDays === 1 ? "" : "s"}`);
  return chalk.green(date.toLocaleDateString());
}

export const tokenCommand = new Command("token")
  .description("Manage CLI tokens for CI/CD and automation");

tokenCommand
  .command("list")
  .alias("ls")
  .description("List all CLI tokens")
  .action(async () => {
    requireAuth();
    const spinner = ora("Fetching tokens...").start();

    try {
      const tokens = await listCliTokens();
      spinner.stop();

      if (tokens.length === 0) {
        console.log(chalk.dim("\nNo CLI tokens found."));
        console.log(chalk.dim("Create one with: mcpize token create <name>\n"));
        return;
      }

      console.log(chalk.bold(`\nCLI Tokens (${tokens.length}):\n`));

      for (const token of tokens) {
        console.log(`  ${chalk.cyan(token.name)}`);
        console.log(`    Prefix:     ${chalk.yellow(token.token_prefix)}...`);
        console.log(`    Created:    ${formatDate(token.created_at)}`);
        console.log(`    Last used:  ${formatDate(token.last_used_at)}`);
        console.log(`    Expires:    ${formatExpiry(token.expires_at)}`);
        console.log(`    ID:         ${chalk.dim(token.id)}`);
        console.log();
      }
    } catch (error) {
      spinner.fail("Failed to list tokens");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

tokenCommand
  .command("create [name]")
  .description("Create a new CLI token")
  .option("--expires <days>", "Token expiration in days (default: never)")
  .action(async (name: string | undefined, options: { expires?: string }) => {
    requireAuth();

    const tokenName = name || `CLI Token ${new Date().toISOString().split("T")[0]}`;
    const expiresInDays = options.expires ? parseInt(options.expires, 10) : undefined;

    if (expiresInDays !== undefined && (isNaN(expiresInDays) || expiresInDays <= 0)) {
      console.error(chalk.red("--expires must be a positive number of days"));
      process.exit(1);
    }

    const spinner = ora("Creating token...").start();

    try {
      const result = await createCliToken(tokenName, expiresInDays);
      spinner.succeed("Token created successfully!\n");

      console.log(chalk.bold.yellow("  IMPORTANT: Copy this token now - it won't be shown again!\n"));
      console.log(`  ${chalk.green(result.token)}\n`);

      console.log(chalk.bold("Usage:\n"));
      console.log(chalk.dim("  # Set as environment variable"));
      console.log(`  export MCPIZE_TOKEN=${result.token}\n`);
      console.log(chalk.dim("  # Or pass directly"));
      console.log(`  mcpize --token ${result.token} whoami\n`);

      console.log(chalk.dim("Token details:"));
      console.log(`  Name:     ${result.name}`);
      console.log(`  Prefix:   ${result.token_prefix}...`);
      console.log(`  Expires:  ${formatExpiry(result.expires_at)}`);
      console.log();
    } catch (error) {
      spinner.fail("Failed to create token");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

tokenCommand
  .command("delete <id>")
  .alias("rm")
  .description("Delete a CLI token by ID or prefix")
  .option("-f, --force", "Skip confirmation prompt")
  .action(async (idOrPrefix: string, options: { force?: boolean }) => {
    requireAuth();

    // First, list tokens to find the one matching the ID or prefix
    const spinner = ora("Looking up token...").start();

    try {
      const tokens = await listCliTokens();

      // Find token by ID or prefix
      const token = tokens.find(
        (t) => t.id === idOrPrefix || t.token_prefix === idOrPrefix || t.token_prefix.startsWith(idOrPrefix),
      );

      if (!token) {
        spinner.fail("Token not found");
        console.error(chalk.dim(`\nNo token found with ID or prefix: ${idOrPrefix}`));
        console.error(chalk.dim("Run 'mcpize token list' to see available tokens.\n"));
        process.exit(1);
      }

      spinner.stop();

      // Confirm deletion
      if (!options.force) {
        console.log(`\nAbout to delete token: ${chalk.cyan(token.name)}`);
        console.log(`  Prefix: ${token.token_prefix}...`);
        console.log(`  ID: ${token.id}\n`);

        const readline = await import("node:readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const confirmed = await new Promise<boolean>((resolve) => {
          rl.question(chalk.yellow("Are you sure? (y/N) "), (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
          });
        });

        if (!confirmed) {
          console.log(chalk.dim("Cancelled."));
          return;
        }
      }

      const deleteSpinner = ora("Deleting token...").start();
      await deleteCliToken(token.id);
      deleteSpinner.succeed(`Token "${token.name}" deleted.\n`);
    } catch (error) {
      spinner.fail("Failed to delete token");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });
