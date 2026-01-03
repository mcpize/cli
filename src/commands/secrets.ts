import chalk from "chalk";
import ora from "ora";
import fs from "node:fs";
import readline from "node:readline";
import { getToken } from "../lib/config.js";
import { loadProjectConfig } from "../lib/project.js";
import {
  listSecrets,
  setSecret,
  deleteSecret,
  exportSecrets,
} from "../lib/api.js";

export interface SecretsOptions {
  environment?: string;
  server?: string;
}

function getServerId(options: SecretsOptions): string {
  // Priority: --server flag > project config
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

export async function secretsListCommand(options: SecretsOptions): Promise<void> {
  requireAuth();
  const serverId = getServerId(options);
  const environment = options.environment || "production";

  const spinner = ora("Fetching secrets...").start();

  try {
    const secrets = await listSecrets(serverId, environment);
    spinner.stop();

    if (secrets.length === 0) {
      console.log(chalk.dim(`No secrets found for environment: ${environment}`));
      return;
    }

    console.log(chalk.bold(`\nSecrets (${environment}):\n`));

    for (const secret of secrets) {
      const required = secret.required ? chalk.yellow(" [required]") : "";
      console.log(`  ${chalk.cyan(secret.name)}${required}`);
      console.log(
        chalk.dim(`    Updated: ${new Date(secret.updated_at).toLocaleString()}`),
      );
    }

    console.log();
  } catch (error) {
    spinner.fail("Failed to list secrets");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export interface SecretsSetOptions extends SecretsOptions {
  required?: boolean;
  fromFile?: string;
}

export async function secretsSetCommand(
  name: string,
  value: string | undefined,
  options: SecretsSetOptions,
): Promise<void> {
  requireAuth();
  const serverId = getServerId(options);
  const environment = options.environment || "production";

  // Validate name format
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    console.error(
      chalk.red(
        "Secret name must be uppercase letters, numbers, and underscores (e.g., OPENAI_API_KEY)",
      ),
    );
    process.exit(1);
  }

  let secretValue: string;

  if (options.fromFile) {
    // Read value from file
    try {
      secretValue = fs.readFileSync(options.fromFile, "utf-8").trim();
    } catch (error) {
      console.error(
        chalk.red(`Failed to read file: ${options.fromFile}`),
      );
      process.exit(1);
    }
  } else if (value) {
    secretValue = value;
  } else {
    // Read from stdin (for piping)
    if (process.stdin.isTTY) {
      // Interactive mode - prompt for value
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      secretValue = await new Promise<string>((resolve) => {
        // Hide input for secrets
        process.stdout.write(`Enter value for ${name}: `);

        let input = "";
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on("data", (char) => {
          const c = char.toString();
          if (c === "\n" || c === "\r") {
            process.stdin.setRawMode(false);
            process.stdout.write("\n");
            rl.close();
            resolve(input);
          } else if (c === "\u0003") {
            // Ctrl+C
            process.exit(0);
          } else if (c === "\u007F") {
            // Backspace
            if (input.length > 0) {
              input = input.slice(0, -1);
            }
          } else {
            input += c;
          }
        });
      });
    } else {
      // Piped input
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      secretValue = Buffer.concat(chunks).toString("utf-8").trim();
    }
  }

  if (!secretValue) {
    console.error(chalk.red("Secret value cannot be empty"));
    process.exit(1);
  }

  const spinner = ora(`Setting ${name}...`).start();

  try {
    await setSecret(serverId, name, secretValue, {
      environment,
      required: options.required,
    });
    spinner.succeed(`Secret ${chalk.cyan(name)} set for ${environment}`);
  } catch (error) {
    spinner.fail(`Failed to set secret ${name}`);
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export async function secretsDeleteCommand(
  name: string,
  options: SecretsOptions,
): Promise<void> {
  requireAuth();
  const serverId = getServerId(options);
  const environment = options.environment || "production";

  const spinner = ora(`Deleting ${name}...`).start();

  try {
    await deleteSecret(serverId, name, environment);
    spinner.succeed(`Secret ${chalk.cyan(name)} deleted from ${environment}`);
  } catch (error) {
    spinner.fail(`Failed to delete secret ${name}`);
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export interface SecretsExportOptions extends SecretsOptions {
  format?: "env" | "json";
}

export async function secretsExportCommand(
  options: SecretsExportOptions,
): Promise<void> {
  requireAuth();
  const serverId = getServerId(options);
  const environment = options.environment || "production";
  const format = options.format || "env";

  const spinner = ora("Exporting secrets...").start();

  try {
    const secrets = await exportSecrets(serverId, environment);
    spinner.stop();

    if (secrets.length === 0) {
      console.error(chalk.dim(`No secrets found for environment: ${environment}`));
      return;
    }

    if (format === "json") {
      const obj: Record<string, string> = {};
      for (const secret of secrets) {
        obj[secret.name] = secret.value;
      }
      console.log(JSON.stringify(obj, null, 2));
    } else {
      // .env format
      for (const secret of secrets) {
        // Escape special characters in value
        const escapedValue = secret.value
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");
        console.log(`${secret.name}="${escapedValue}"`);
      }
    }
  } catch (error) {
    spinner.fail("Failed to export secrets");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}

export interface SecretsImportOptions extends SecretsOptions {
  dryRun?: boolean;
}

/**
 * Parse .env file content into key-value pairs
 */
function parseEnvFile(content: string): Array<{ name: string; value: string }> {
  const secrets: Array<{ name: string; value: string }> = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Match KEY=value or KEY="value" or KEY='value'
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, name, rawValue] = match;
    let value = rawValue;

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Unescape common escape sequences
    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");

    secrets.push({ name, value });
  }

  return secrets;
}

export async function secretsImportCommand(
  filePath: string,
  options: SecretsImportOptions,
): Promise<void> {
  requireAuth();
  const serverId = getServerId(options);
  const environment = options.environment || "production";

  // Read and parse .env file
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    console.error(chalk.red(`Failed to read file: ${filePath}`));
    process.exit(1);
  }

  const secrets = parseEnvFile(content);

  if (secrets.length === 0) {
    console.log(chalk.yellow("No valid secrets found in file."));
    console.log(
      chalk.dim("Expected format: KEY=value (uppercase letters and underscores)"),
    );
    return;
  }

  console.log(chalk.bold(`\nFound ${secrets.length} secrets to import:\n`));
  for (const secret of secrets) {
    const preview = secret.value.length > 20
      ? secret.value.substring(0, 20) + "..."
      : secret.value;
    console.log(`  ${chalk.cyan(secret.name)} = ${chalk.dim(`"${preview}"`)}`);
  }
  console.log();

  if (options.dryRun) {
    console.log(chalk.yellow("Dry run - no secrets were imported."));
    return;
  }

  const spinner = ora(`Importing ${secrets.length} secrets...`).start();

  let successCount = 0;
  let failCount = 0;

  for (const secret of secrets) {
    try {
      await setSecret(serverId, secret.name, secret.value, { environment });
      successCount++;
      spinner.text = `Importing secrets... (${successCount}/${secrets.length})`;
    } catch (error) {
      failCount++;
      console.error(
        chalk.red(
          `\nFailed to set ${secret.name}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  if (failCount === 0) {
    spinner.succeed(
      `Imported ${successCount} secrets to ${environment}`,
    );
  } else {
    spinner.warn(
      `Imported ${successCount} secrets, ${failCount} failed`,
    );
  }
}
