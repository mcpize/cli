import chalk from "chalk";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { hasManifest, loadManifest, loadPackageJson } from "../lib/project.js";
import { loadProjectConfig } from "../lib/project.js";
import { getToken } from "../lib/config.js";

export interface DoctorOptions {
  manifest?: boolean;
  dockerfile?: boolean;
  fix?: boolean;
}

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
}

function check(
  name: string,
  condition: boolean,
  passMessage: string,
  failMessage: string,
  fix?: string,
): CheckResult {
  return {
    name,
    status: condition ? "pass" : "fail",
    message: condition ? passMessage : failMessage,
    fix: condition ? undefined : fix,
  };
}

function warn(name: string, message: string, fix?: string): CheckResult {
  return { name, status: "warn", message, fix };
}

function formatResult(result: CheckResult): void {
  const icon =
    result.status === "pass"
      ? chalk.green("✓")
      : result.status === "warn"
        ? chalk.yellow("!")
        : chalk.red("✗");

  const color =
    result.status === "pass"
      ? chalk.green
      : result.status === "warn"
        ? chalk.yellow
        : chalk.red;

  console.log(`  ${icon} ${result.name}: ${color(result.message)}`);

  if (result.fix) {
    console.log(chalk.dim(`      Fix: ${result.fix}`));
  }
}

function getNodeVersion(): string | null {
  try {
    const version = execSync("node --version", { encoding: "utf-8" }).trim();
    return version.replace("v", "");
  } catch {
    return null;
  }
}

function getNpmVersion(): string | null {
  try {
    return execSync("npm --version", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function getDockerVersion(): string | null {
  try {
    const output = execSync("docker --version", { encoding: "utf-8" }).trim();
    const match = output.match(/Docker version (\d+\.\d+\.\d+)/);
    return match ? match[1] : output;
  } catch {
    return null;
  }
}

function checkRuntimeEnvironment(): CheckResult[] {
  const results: CheckResult[] = [];

  // Node.js version
  const nodeVersion = getNodeVersion();
  if (nodeVersion) {
    const major = parseInt(nodeVersion.split(".")[0], 10);
    if (major >= 20) {
      results.push(check("Node.js", true, `v${nodeVersion}`, ""));
    } else {
      results.push(
        check(
          "Node.js",
          false,
          "",
          `v${nodeVersion} (requires v20+)`,
          "Install Node.js 20 LTS: https://nodejs.org/",
        ),
      );
    }
  } else {
    results.push(
      check(
        "Node.js",
        false,
        "",
        "Not installed",
        "Install Node.js 20 LTS: https://nodejs.org/",
      ),
    );
  }

  // npm version
  const npmVersion = getNpmVersion();
  if (npmVersion) {
    results.push(check("npm", true, `v${npmVersion}`, ""));
  } else {
    results.push(check("npm", false, "", "Not installed"));
  }

  // Docker (optional but recommended)
  const dockerVersion = getDockerVersion();
  if (dockerVersion) {
    results.push(check("Docker", true, `v${dockerVersion}`, ""));
  } else {
    results.push(
      warn("Docker", "Not installed (optional for local testing)", "Install Docker: https://docker.com/"),
    );
  }

  return results;
}

function checkProject(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];

  // mcpize.yaml
  if (hasManifest(cwd)) {
    const manifest = loadManifest(cwd);
    if (manifest) {
      results.push(check("mcpize.yaml", true, "Found and valid", ""));

      // Check required fields
      if (manifest.runtime) {
        results.push(check("Manifest: runtime", true, manifest.runtime, ""));
      } else {
        results.push(
          check(
            "Manifest: runtime",
            false,
            "",
            "Missing 'runtime' field",
            "Add 'runtime: node20' to mcpize.yaml",
          ),
        );
      }

      if (manifest.entry) {
        results.push(check("Manifest: entry", true, manifest.entry, ""));
      } else {
        results.push(
          warn("Manifest: entry", "Not specified (will use default)"),
        );
      }
    } else {
      results.push(
        check(
          "mcpize.yaml",
          false,
          "",
          "Invalid YAML syntax",
          "Check mcpize.yaml for syntax errors",
        ),
      );
    }
  } else {
    results.push(
      check(
        "mcpize.yaml",
        false,
        "",
        "Not found",
        "Run: mcpize init",
      ),
    );
  }

  // package.json
  const packageJson = loadPackageJson(cwd);
  if (packageJson) {
    results.push(check("package.json", true, "Found", ""));

    // Check for main/entry
    if (packageJson.main || packageJson.exports) {
      results.push(check("Package entry", true, packageJson.main || "exports defined", ""));
    } else {
      results.push(warn("Package entry", "No 'main' or 'exports' field"));
    }
  } else {
    results.push(warn("package.json", "Not found (may not be a Node.js project)"));
  }

  // .mcpize/project.json (linked server)
  const projectConfig = loadProjectConfig(cwd);
  if (projectConfig?.serverId) {
    results.push(
      check("Project linked", true, `Server: ${projectConfig.serverName || projectConfig.serverId.slice(0, 8)}`, ""),
    );
  } else {
    results.push(
      warn("Project linked", "Not linked to server", "Run: mcpize link or mcpize deploy"),
    );
  }

  return results;
}

function checkAuth(): CheckResult[] {
  const results: CheckResult[] = [];

  const token = getToken();
  if (token) {
    results.push(check("Authentication", true, "Logged in", ""));
  } else {
    results.push(
      check(
        "Authentication",
        false,
        "",
        "Not logged in",
        "Run: mcpize login",
      ),
    );
  }

  return results;
}

function checkDockerfile(cwd: string): CheckResult[] {
  const results: CheckResult[] = [];
  const dockerfilePath = join(cwd, "Dockerfile");

  if (!existsSync(dockerfilePath)) {
    results.push(
      warn("Dockerfile", "Not found (will use auto-generated)", "Create Dockerfile for custom builds"),
    );
    return results;
  }

  results.push(check("Dockerfile", true, "Found", ""));

  // Basic Dockerfile checks (without parsing)
  try {
    const { readFileSync } = require("node:fs");
    const content = readFileSync(dockerfilePath, "utf-8");

    // Check for EXPOSE 8080
    if (content.includes("EXPOSE 8080")) {
      results.push(check("Dockerfile: PORT", true, "EXPOSE 8080 configured", ""));
    } else {
      results.push(
        warn("Dockerfile: PORT", "EXPOSE 8080 not found (required for Cloud Run)"),
      );
    }

    // Check for non-root user
    if (content.includes("USER ") && !content.includes("USER root")) {
      results.push(check("Dockerfile: USER", true, "Non-root user configured", ""));
    } else {
      results.push(
        warn("Dockerfile: USER", "Running as root (consider adding USER directive)", "Add 'USER node' or 'USER nobody'"),
      );
    }

    // Check for health check
    if (content.includes("HEALTHCHECK")) {
      results.push(check("Dockerfile: HEALTHCHECK", true, "Health check configured", ""));
    } else {
      results.push(
        warn("Dockerfile: HEALTHCHECK", "No health check (recommended for production)"),
      );
    }
  } catch {
    results.push(warn("Dockerfile", "Could not read file"));
  }

  return results;
}

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.bold("\nMCPize Doctor - Local Diagnostics\n"));

  let allResults: CheckResult[] = [];
  let hasErrors = false;

  // Runtime Environment
  if (!options.manifest && !options.dockerfile) {
    console.log(chalk.bold("Runtime Environment:"));
    const runtimeResults = checkRuntimeEnvironment();
    runtimeResults.forEach(formatResult);
    allResults = allResults.concat(runtimeResults);
    console.log();
  }

  // Authentication
  if (!options.manifest && !options.dockerfile) {
    console.log(chalk.bold("Authentication:"));
    const authResults = checkAuth();
    authResults.forEach(formatResult);
    allResults = allResults.concat(authResults);
    console.log();
  }

  // Project Configuration
  if (!options.dockerfile) {
    console.log(chalk.bold("Project Configuration:"));
    const projectResults = checkProject(cwd);
    projectResults.forEach(formatResult);
    allResults = allResults.concat(projectResults);
    console.log();
  }

  // Dockerfile (if --dockerfile or found)
  if (options.dockerfile || existsSync(join(cwd, "Dockerfile"))) {
    console.log(chalk.bold("Dockerfile:"));
    const dockerResults = checkDockerfile(cwd);
    dockerResults.forEach(formatResult);
    allResults = allResults.concat(dockerResults);
    console.log();
  }

  // Summary
  const passed = allResults.filter((r) => r.status === "pass").length;
  const warnings = allResults.filter((r) => r.status === "warn").length;
  const failed = allResults.filter((r) => r.status === "fail").length;

  console.log(chalk.bold("Summary:"));
  console.log(
    `  ${chalk.green(passed + " passed")}, ${chalk.yellow(warnings + " warnings")}, ${chalk.red(failed + " failed")}`,
  );

  if (failed > 0) {
    console.log(chalk.red("\nSome checks failed. Please fix the issues above before deploying."));
    hasErrors = true;
  } else if (warnings > 0) {
    console.log(chalk.yellow("\nAll checks passed with warnings."));
  } else {
    console.log(chalk.green("\nAll checks passed! Ready to deploy."));
  }

  console.log();

  if (hasErrors) {
    process.exit(1);
  }
}
