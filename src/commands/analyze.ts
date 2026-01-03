import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";
import { writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { createTarball, formatBytes } from "../lib/tarball.js";
import { analyzeProject } from "../lib/api.js";
import { hasManifest, loadPackageJson } from "../lib/project.js";

const { prompt } = Enquirer;

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
  let yaml: string;
  try {
    yaml = await analyzeProject(tarball, projectName);
    analyzeSpinner.succeed("Analysis complete");
  } catch (error) {
    analyzeSpinner.fail("Analysis failed");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }

  // Preview
  console.log("\n" + chalk.dim("─".repeat(50)));
  console.log(yaml);
  console.log(chalk.dim("─".repeat(50)) + "\n");

  if (options.dryRun) {
    console.log(chalk.dim("Dry run - no file written."));
    return;
  }

  // Confirm unless --yes
  let shouldSave = options.yes;
  if (!shouldSave) {
    try {
      const response = await prompt<{ confirm: boolean }>({
        type: "confirm",
        name: "confirm",
        message: "Save mcpize.yaml?",
        initial: true,
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
