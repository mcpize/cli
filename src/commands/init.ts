import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { downloadTemplate, fetchTemplatesList } from "../lib/degit.js";

const { prompt } = Enquirer;

/**
 * Resolve project name when user runs `mcpize init .`
 * Priority: existing package.json name → current directory name
 */
function resolveProjectName(targetDir: string, providedName: string): string {
  // If name is "." or empty, we're initializing in current directory
  const isCurrentDir = providedName === "." || providedName === "";

  if (!isCurrentDir) {
    return providedName;
  }

  // Try to read name from existing package.json
  const packageJsonPath = path.join(targetDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      // Use package.json name if it's valid (not "." or empty)
      if (pkg.name && pkg.name !== "." && pkg.name.trim() !== "") {
        return pkg.name;
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Fallback to directory name
  return path.basename(path.resolve(targetDir));
}

export interface InitOptions {
  template?: string;
  dir?: string;
  noInstall?: boolean;
  noGit?: boolean;
  // All other options passed through to template post-init
  [key: string]: unknown;
}

interface TemplateConfig {
  postInit?: string;
  options?: Record<
    string,
    {
      description?: string;
      required?: boolean;
    }
  >;
}

/**
 * Convert options to environment variables for post-init script
 * --from-url -> MCPIZE_INIT_FROM_URL
 * --some-option -> MCPIZE_INIT_SOME_OPTION
 */
function optionsToEnv(options: InitOptions): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(options)) {
    // Skip internal options
    if (["template", "dir", "noInstall", "noGit"].includes(key)) {
      continue;
    }

    if (value !== undefined && value !== null && value !== false) {
      // Convert camelCase to SCREAMING_SNAKE_CASE
      const envKey =
        "MCPIZE_INIT_" +
        key
          .replace(/([A-Z])/g, "_$1")
          .toUpperCase()
          .replace(/^_/, "");

      env[envKey] = String(value);
    }
  }

  return env;
}

/**
 * Load and parse template.config.json if it exists
 */
function loadTemplateConfig(targetDir: string): TemplateConfig | null {
  const configPath = path.join(targetDir, "template.config.json");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // Remove config file from output (it's internal)
    fs.unlinkSync(configPath);
    return config;
  } catch {
    return null;
  }
}

/**
 * Run post-init script if defined in template config
 * Script runs from target directory
 */
async function runPostInit(
  targetDir: string,
  templateConfig: TemplateConfig,
  options: InitOptions,
): Promise<boolean> {
  if (!templateConfig.postInit) {
    return true;
  }

  const spinner = ora("Running post-init script...").start();

  try {
    // Build environment with all options
    const optionsEnv = optionsToEnv(options);

    // Check if any options were passed (excluding internal ones)
    const hasCustomOptions = Object.keys(optionsEnv).length > 0;

    if (!hasCustomOptions) {
      spinner.info("Skipping post-init (no custom options provided)");
      return true;
    }

    const env = {
      ...process.env,
      ...optionsEnv,
      MCPIZE_PROJECT_DIR: targetDir,
      MCPIZE_PROJECT_NAME: path.basename(targetDir),
    };

    // Run post-init from target directory
    execSync(templateConfig.postInit, {
      cwd: targetDir,
      stdio: "inherit",
      env,
    });

    spinner.succeed("Post-init completed");
    return true;
  } catch (error) {
    spinner.fail("Post-init failed");
    if (error instanceof Error && "stderr" in error) {
      console.error(chalk.red(String((error as { stderr: Buffer }).stderr)));
    } else {
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
    }
    return false;
  }
}

export async function initCommand(
  name: string | undefined,
  options: InitOptions,
): Promise<void> {
  console.log(chalk.bold("\nMCPize Init\n"));

  // Check if initializing in current directory
  const isCurrentDir = name === ".";

  // Determine target directory first
  let targetDir: string;
  if (options.dir) {
    targetDir = options.dir;
  } else if (isCurrentDir) {
    targetDir = process.cwd();
  } else if (name) {
    targetDir = path.join(process.cwd(), name);
  } else {
    // No name provided, will prompt below
    targetDir = process.cwd();
  }

  // Determine project name
  let projectName: string;
  if (name && !isCurrentDir) {
    // Explicit name provided (not ".")
    projectName = name;
  } else if (isCurrentDir || !name) {
    // Either "." or no name - resolve from package.json or folder name
    const resolvedName = resolveProjectName(targetDir, name || ".");

    if (!name) {
      // No name provided at all - prompt with resolved name as default
      const response = await prompt<{ name: string }>({
        type: "input",
        name: "name",
        message: "Project name:",
        initial: resolvedName,
      });
      projectName = response.name;
      // Update targetDir if user changed the name and we weren't using "."
      if (!isCurrentDir && projectName !== resolvedName) {
        targetDir = path.join(process.cwd(), projectName);
      }
    } else {
      // "." was provided - use resolved name
      projectName = resolvedName;
    }
  } else {
    projectName = name;
  }

  // Check if directory exists and has files
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    const displayDir = isCurrentDir ? "Current directory" : `Directory "${projectName}"`;
    const response = await prompt<{ overwrite: boolean }>({
      type: "confirm",
      name: "overwrite",
      message: `${displayDir} is not empty. Continue anyway?`,
      initial: false,
    });

    if (!response.overwrite) {
      console.log(chalk.dim("\nInit cancelled."));
      process.exit(0);
    }
  }

  // Fetch available templates
  const templates = await fetchTemplatesList();

  // Determine template
  let template = options.template;

  if (!template) {
    const response = await prompt<{ template: string }>({
      type: "select",
      name: "template",
      message: "Select template:",
      choices: templates.map((t) => ({
        name: t.name,
        message: `${t.name} - ${t.description}`,
      })),
    });
    template = response.template;
  } else {
    // Normalize template name: "typescript" -> "typescript/default"
    if (!template.includes("/")) {
      template = `${template}/default`;
    }
    // Also handle "openapi" -> "typescript/openapi"
    if (template === "openapi" || template === "openapi/default") {
      template = "typescript/openapi";
    }
  }

  // Download template from GitHub
  const spinner = ora(`Downloading template ${template}...`).start();

  try {
    await downloadTemplate(template, targetDir, { force: true });
    spinner.succeed(`Downloaded ${template}`);
  } catch (error) {
    spinner.fail(`Failed to download template "${template}"`);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for common errors
    if (errorMessage.includes("could not find")) {
      console.error(
        chalk.red(`Template "${template}" not found in repository.`),
      );
      console.error(
        chalk.dim(
          `Available templates: ${templates.map((t) => t.name).join(", ")}`,
        ),
      );
    } else if (errorMessage.includes("rate limit")) {
      console.error(
        chalk.red("GitHub API rate limit exceeded. Try again later."),
      );
    } else {
      console.error(chalk.red(errorMessage));
    }

    process.exit(1);
  }

  // Load template config (and remove it from output)
  const templateConfig = loadTemplateConfig(targetDir);

  // Update package.json name
  const packageJsonPath = path.join(targetDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      packageJson.name = projectName;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    } catch {
      // Ignore package.json errors
    }
  }

  // Initialize git
  if (!options.noGit) {
    try {
      execSync("git init", { cwd: targetDir, stdio: "pipe" });
      console.log(chalk.dim("Initialized git repository"));
    } catch {
      // Git not available, skip
    }
  }

  // Run post-init script if defined (before npm install, so it can modify package.json)
  if (templateConfig) {
    const success = await runPostInit(targetDir, templateConfig, options);
    if (!success) {
      console.error(
        chalk.yellow(
          "\nPost-init failed. Project created but may need manual setup.",
        ),
      );
    }
  }

  // Install dependencies
  if (!options.noInstall) {
    const installSpinner = ora("Installing dependencies...").start();

    try {
      // Detect project type and package manager
      const hasPyproject = fs.existsSync(
        path.join(targetDir, "pyproject.toml"),
      );
      const hasComposer = fs.existsSync(path.join(targetDir, "composer.json"));
      const hasPackageJson = fs.existsSync(
        path.join(targetDir, "package.json"),
      );

      if (hasPyproject) {
        // Python project - use uv
        execSync("uv sync", { cwd: targetDir, stdio: "pipe" });
        installSpinner.succeed("Dependencies installed (uv)");
      } else if (hasComposer) {
        // PHP project - use composer
        execSync("composer install", { cwd: targetDir, stdio: "pipe" });
        installSpinner.succeed("Dependencies installed (composer)");
      } else if (hasPackageJson) {
        // Node.js project - detect package manager
        const hasYarn = fs.existsSync(path.join(targetDir, "yarn.lock"));
        const hasPnpm = fs.existsSync(path.join(targetDir, "pnpm-lock.yaml"));
        const pm = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";

        execSync(`${pm} install`, { cwd: targetDir, stdio: "pipe" });
        installSpinner.succeed(`Dependencies installed (${pm})`);
      } else {
        installSpinner.info(
          "No package.json, pyproject.toml or composer.json found",
        );
      }
    } catch (error) {
      installSpinner.fail("Failed to install dependencies");
      const hasPyproject = fs.existsSync(
        path.join(targetDir, "pyproject.toml"),
      );
      const hasComposer = fs.existsSync(path.join(targetDir, "composer.json"));
      if (hasPyproject) {
        console.error(chalk.dim("Run 'uv sync' manually"));
      } else if (hasComposer) {
        console.error(chalk.dim("Run 'composer install' manually"));
      } else {
        console.error(chalk.dim("Run 'npm install' manually"));
      }
    }
  }

  // Print next steps
  console.log(chalk.bold.green(`\n✓ Project "${projectName}" created!\n`));
  console.log("Next steps:");
  // Only show cd if not in current directory
  if (!isCurrentDir) {
    console.log(chalk.dim(`  cd ${projectName}`));
  }

  // Detect project type for appropriate commands
  const isPython = fs.existsSync(path.join(targetDir, "pyproject.toml"));
  const isPHP = fs.existsSync(path.join(targetDir, "composer.json"));

  if (options.noInstall) {
    if (isPython) {
      console.log(chalk.dim("  uv sync"));
    } else if (isPHP) {
      console.log(chalk.dim("  composer install"));
    } else {
      console.log(chalk.dim("  npm install"));
    }
  }

  // Special instructions for OpenAPI template without --from-url
  const hasFromUrl = options.fromUrl || options.fromFile;
  const isOpenApiTemplate =
    template === "typescript/openapi" || template === "python/openapi";
  if (isOpenApiTemplate && !hasFromUrl) {
    console.log(chalk.dim("  # Generate from URL:"));
    console.log(
      chalk.dim(
        `  mcpize init . --template ${template} --from-url <openapi-url>`,
      ),
    );
    console.log(chalk.dim("  # Or from local file:"));
    console.log(
      chalk.dim(
        `  mcpize init . --template ${template} --from-file ./openapi.yaml`,
      ),
    );
    console.log();
  }

  console.log(chalk.dim("  mcpize dev         # Start local development"));
  console.log(chalk.dim("  mcpize deploy      # Deploy to MCPize"));
  console.log();
}
