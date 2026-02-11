import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";
import { writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { createTarball, formatBytes } from "../lib/tarball.js";
import { analyzeProject, type AnalyzeResult, type DetectedSecret, type CredentialDefinition } from "../lib/api.js";
import { hasManifest, loadPackageJson } from "../lib/project.js";

const { prompt } = Enquirer;

/**
 * Get confidence bar visualization
 */
function getConfidenceBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(empty));
}

/**
 * Get confidence color based on level
 */
function getConfidenceColor(confidence: 'high' | 'medium' | 'low'): typeof chalk {
  switch (confidence) {
    case 'high': return chalk.green;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.red;
  }
}

/**
 * Print detection summary
 */
function printDetectionSummary(result: AnalyzeResult): void {
  const confidenceColor = getConfidenceColor(result.confidence);
  const bar = getConfidenceBar(result.confidencePercent);
  const confidenceLabel = result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1);

  console.log(chalk.bold("\nDetection Summary"));
  console.log(chalk.dim("─".repeat(40)));
  console.log(`  Confidence:  ${bar} ${result.confidencePercent}% ${confidenceColor(`(${confidenceLabel})`)}`);
  console.log(`  Source:      ${chalk.dim(result.source)}`);
  console.log();
  console.log(`  Runtime:     ${chalk.cyan(result.detected.runtime)}`);
  console.log(`  Entry:       ${chalk.cyan(result.detected.entryPoint || 'auto-detect')}`);
  console.log(`  Transport:   ${chalk.cyan(result.detected.transport)}`);
  if (result.detected.buildCommand) {
    console.log(`  Build:       ${chalk.dim(result.detected.buildCommand)}`);
  }
}

/**
 * Print warnings section
 */
function printWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;

  console.log(chalk.yellow(`\n⚠ Warnings (${warnings.length}):`));
  for (const warning of warnings) {
    console.log(chalk.yellow(`  • ${warning}`));
  }
}

/**
 * Print secrets and credentials
 */
function printSecretsAndCredentials(
  secrets: DetectedSecret[],
  credentials: CredentialDefinition[],
  credentialsMode: 'per_user' | 'shared'
): void {
  if (secrets.length > 0) {
    console.log(chalk.bold(`\nDetected Secrets (${secrets.length}):`));
    for (const secret of secrets) {
      const required = secret.required ? chalk.red("required") : chalk.dim("optional");
      const desc = secret.description ? chalk.dim(` - ${secret.description}`) : "";
      console.log(`  • ${chalk.cyan(secret.name)} (${required})${desc}`);
    }
  }

  if (credentials.length > 0) {
    const modeLabel = credentialsMode === 'per_user' ? chalk.blue("per_user") : chalk.dim("shared");
    console.log(chalk.bold(`\nDetected Credentials (${credentials.length}) [${modeLabel}]:`));
    for (const cred of credentials) {
      const required = cred.required !== false ? chalk.red("required") : chalk.dim("optional");
      const desc = cred.description ? chalk.dim(` - ${cred.description}`) : "";
      console.log(`  • ${chalk.cyan(cred.name)} (${required})${desc}`);
      if (cred.docs_url) {
        console.log(chalk.dim(`    Docs: ${cred.docs_url}`));
      }
    }
  }

  // Private registry warning
  // Note: privateRegistry is included in the result if detected
}

/**
 * Print private registry warning if detected
 */
function printPrivateRegistryWarning(result: AnalyzeResult): void {
  if (result.privateRegistry?.detected && result.privateRegistry.needsNpmToken) {
    console.log(chalk.yellow("\n⚠ Private npm registry detected:"));
    console.log(chalk.dim(`  Registry: ${result.privateRegistry.domain || 'unknown'}`));
    console.log(chalk.dim("  You may need to add NPM_TOKEN to your secrets for deployment."));
  }
}

// Size limits
const MAX_TARBALL_SIZE = 50 * 1024 * 1024; // 50 MB - Edge function limit
const WARN_TARBALL_SIZE = 10 * 1024 * 1024; // 10 MB - Show warning

/**
 * Get directory sizes for debugging large tarballs
 */
function getLargeDirectories(dir: string, limit = 5): { name: string; size: number }[] {
  const results: { name: string; size: number }[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip already-excluded directories
      const skipDirs = ["node_modules", ".git", "dist", "build", ".venv", "venv", "__pycache__"];
      if (skipDirs.includes(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      const size = getDirSize(fullPath);
      if (size > 1024 * 1024) {
        // > 1 MB
        results.push({ name: entry.name, size });
      }
    }
  } catch {
    // Ignore errors
  }

  return results.sort((a, b) => b.size - a.size).slice(0, limit);
}

/**
 * Recursively calculate directory size
 */
function getDirSize(dir: string): number {
  let size = 0;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else if (entry.isFile()) {
        try {
          size += statSync(fullPath).size;
        } catch {
          // Skip inaccessible files
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return size;
}

export interface AnalyzeOptions {
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Analyze current project and generate mcpize.yaml
 */
export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.bold("\nMCPize Analyze\n"));

  // Check if mcpize.yaml already exists
  if (hasManifest(cwd) && !options.force) {
    console.error(chalk.yellow("mcpize.yaml already exists."));
    console.error(chalk.dim("Use --force to overwrite."));
    process.exit(1);
  }

  // Try to get project name from package.json
  const packageJson = loadPackageJson(cwd);
  const projectName = packageJson?.name || basename(cwd);

  // Create tarball
  const tarballSpinner = ora("Creating tarball...").start();
  let tarball: Buffer;
  try {
    tarball = await createTarball({ cwd });
    tarballSpinner.succeed(`Tarball created (${formatBytes(tarball.length)})`);
  } catch (error) {
    tarballSpinner.fail("Failed to create tarball");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }

  // Check tarball size
  if (tarball.length > MAX_TARBALL_SIZE) {
    console.error(
      chalk.red(`\nTarball too large: ${formatBytes(tarball.length)} (max ${formatBytes(MAX_TARBALL_SIZE)})`),
    );
    console.log(chalk.yellow("\nThis usually means you're in a parent directory with multiple projects."));
    console.log(chalk.yellow("Run this command inside a specific project directory.\n"));

    // Show large directories
    const largeDirs = getLargeDirectories(cwd);
    if (largeDirs.length > 0) {
      console.log(chalk.dim("Large directories found:"));
      for (const dir of largeDirs) {
        console.log(chalk.dim(`  ${dir.name}/  ${formatBytes(dir.size)}`));
      }
      console.log();
    }

    console.log(chalk.dim("To exclude directories, create .mcpizeignore:"));
    console.log(chalk.dim("  echo 'large-folder' >> .mcpizeignore\n"));

    process.exit(1);
  }

  // Warn about large tarballs
  if (tarball.length > WARN_TARBALL_SIZE) {
    console.log(
      chalk.yellow(`\nWarning: Tarball is large (${formatBytes(tarball.length)}). Analysis may be slow.`),
    );

    const largeDirs = getLargeDirectories(cwd);
    if (largeDirs.length > 0) {
      console.log(chalk.dim("Consider excluding these directories via .mcpizeignore:"));
      for (const dir of largeDirs) {
        console.log(chalk.dim(`  ${dir.name}/  ${formatBytes(dir.size)}`));
      }
    }
    console.log();
  }

  // Analyze via API
  const analyzeSpinner = ora("Analyzing project...").start();
  let result: AnalyzeResult;
  try {
    result = await analyzeProject(tarball, projectName);
    analyzeSpinner.succeed("Analysis complete");
  } catch (error) {
    analyzeSpinner.fail("Analysis failed");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }

  // Show detection summary
  printDetectionSummary(result);

  // Show secrets and credentials
  printSecretsAndCredentials(
    result.secrets,
    result.credentials,
    result.credentials_mode
  );

  // Show private registry warning if detected
  printPrivateRegistryWarning(result);

  // Show warnings
  printWarnings(result.warnings);

  // Preview YAML
  const yaml = result.yaml || "";
  console.log("\n" + chalk.dim("─".repeat(50)));
  console.log(yaml);
  console.log(chalk.dim("─".repeat(50)) + "\n");

  if (options.dryRun) {
    console.log(chalk.dim("Dry run - no file written."));
    return;
  }

  // Confirm - adjust default based on confidence
  let shouldSave = options.yes;
  if (!shouldSave) {
    const defaultYes = result.confidence === 'high' || result.confidence === 'medium';
    try {
      const response = await prompt<{ confirm: boolean }>({
        type: "confirm",
        name: "confirm",
        message: result.confidence === 'low'
          ? "Low confidence detection. Save mcpize.yaml anyway?"
          : "Save mcpize.yaml?",
        initial: defaultYes,
      });
      shouldSave = response.confirm;
    } catch {
      // User cancelled (Ctrl+C)
      console.log(chalk.dim("\nCancelled."));
      process.exit(0);
    }
  }

  if (shouldSave) {
    const manifestPath = join(cwd, "mcpize.yaml");
    writeFileSync(manifestPath, yaml);
    console.log(chalk.green("✓ Created mcpize.yaml"));
    console.log(chalk.dim("\nNext steps:"));
    console.log(chalk.dim("  mcpize deploy    Deploy to MCPize"));
    console.log(chalk.dim("  mcpize dev       Run local development server"));
  } else {
    console.log(chalk.dim("Cancelled."));
  }
}
