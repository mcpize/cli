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
