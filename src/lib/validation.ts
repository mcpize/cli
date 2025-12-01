import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";
import chalk from "chalk";
import ora from "ora";
import type { McpizeManifest } from "./project.js";

// ============================================
// Schema Validation
// ============================================

const ManifestSchema = z.object({
  version: z.number().min(1).max(1),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  runtime: z.enum(["typescript", "python", "php"]),
  entry: z.string().optional(),
  build: z
    .object({
      install: z.string().optional(),
      command: z.string().optional(),
    })
    .optional(),
  startCommand: z
    .object({
      type: z.enum(["http", "stdio"]),
      command: z.string().min(1),
    })
    .optional(),
  configSchema: z
    .object({
      source: z.enum(["code", "inline"]),
    })
    .optional(),
});

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateManifest(manifest: unknown): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  const parsed = ManifestSchema.safeParse(manifest);

  if (!parsed.success) {
    result.valid = false;
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".");
      result.errors.push(`${path}: ${issue.message}`);
    }
  }

  return result;
}

// ============================================
// Dependency Check
// ============================================

export function checkDependencies(
  cwd: string,
  runtime: McpizeManifest["runtime"],
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  switch (runtime) {
    case "typescript": {
      const packageJsonPath = join(cwd, "package.json");
      if (!existsSync(packageJsonPath)) {
        result.valid = false;
        result.errors.push("package.json not found");
      }
      break;
    }
    case "python": {
      const hasRequirements = existsSync(join(cwd, "requirements.txt"));
      const hasPyproject = existsSync(join(cwd, "pyproject.toml"));
      if (!hasRequirements && !hasPyproject) {
        result.warnings.push(
          "No requirements.txt or pyproject.toml found - dependencies may be missing",
        );
      }
      break;
    }
    case "php": {
      const composerPath = join(cwd, "composer.json");
      if (!existsSync(composerPath)) {
        result.warnings.push(
          "composer.json not found - dependencies may be missing",
        );
      }
      break;
    }
  }

  return result;
}

// ============================================
// Pre-Build Check
// ============================================

export interface BuildCheckResult {
  success: boolean;
  output?: string;
  error?: string;
  skipped?: boolean;
}

export function runPreBuildCheck(
  cwd: string,
  manifest: McpizeManifest,
): BuildCheckResult {
  // Check if custom build command exists
  if (manifest.build?.command) {
    try {
      const output = execSync(manifest.build.command, {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120000, // 2 minutes
      });
      return { success: true, output };
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      return {
        success: false,
        error: err.stderr || err.message || "Build failed",
      };
    }
  }

  // Auto-detect build for TypeScript
  if (manifest.runtime === "typescript") {
    const packageJsonPath = join(cwd, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        const scripts = packageJson.scripts || {};

        // Try build script if exists
        if (scripts.build) {
          try {
            const output = execSync("npm run build", {
              cwd,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 120000,
            });
            return { success: true, output };
          } catch (error) {
            const err = error as { stderr?: string; message?: string };
            return {
              success: false,
              error: err.stderr || err.message || "npm run build failed",
            };
          }
        }

        // Try typecheck if no build script
        if (scripts.typecheck) {
          try {
            const output = execSync("npm run typecheck", {
              cwd,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 60000,
            });
            return { success: true, output };
          } catch (error) {
            const err = error as { stderr?: string; message?: string };
            return {
              success: false,
              error: err.stderr || err.message || "Type check failed",
            };
          }
        }
      } catch {
        // Failed to parse package.json, skip
      }
    }
  }

  // Python syntax check
  if (manifest.runtime === "python") {
    const entry = manifest.entry || "main.py";
    // Validate entry doesn't contain dangerous characters
    if (!/^[\w./-]+$/.test(entry)) {
      return { success: false, error: "Invalid entry file path" };
    }
    const entryPath = join(cwd, entry);
    if (existsSync(entryPath)) {
      try {
        execSync(`python3 -m py_compile "${entry}"`, {
          cwd,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 30000,
        });
        return { success: true };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return {
          success: false,
          error: err.stderr || err.message || "Python syntax error",
        };
      }
    }
  }

  return { success: true, skipped: true };
}

// ============================================
// Size Check
// ============================================

export interface SizeCheckResult {
  sizeBytes: number;
  sizeFormatted: string;
  warning?: string;
  error?: string;
}

const SIZE_WARNING_THRESHOLD = 50 * 1024 * 1024; // 50MB
const SIZE_ERROR_THRESHOLD = 100 * 1024 * 1024; // 100MB

export function checkTarballSize(sizeBytes: number): SizeCheckResult {
  const sizeFormatted = formatBytes(sizeBytes);
  const result: SizeCheckResult = { sizeBytes, sizeFormatted };

  if (sizeBytes > SIZE_ERROR_THRESHOLD) {
    result.error = `Tarball too large (${sizeFormatted}). Max: 100MB. Check .mcpizeignore`;
  } else if (sizeBytes > SIZE_WARNING_THRESHOLD) {
    result.warning = `Large tarball (${sizeFormatted}). Consider excluding files in .mcpizeignore`;
  }

  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================
// Post-Deploy Health Check
// ============================================

export interface HealthCheckResult {
  httpOk: boolean;
  mcpOk: boolean;
  httpStatus?: number;
  httpError?: string;
  mcpError?: string;
  tools?: string[];
}

export async function runHealthCheck(
  slug: string,
  maxRetries = 5,
  retryDelayMs = 3000,
): Promise<HealthCheckResult> {
  const gatewayUrl = `https://${slug}.mcpize.run`;
  const result: HealthCheckResult = {
    httpOk: false,
    mcpOk: false,
  };

  // HTTP health check with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
        signal: AbortSignal.timeout(10000),
      });

      result.httpStatus = response.status;

      // Any response means server is up (even 401/403 auth errors)
      if (response.status > 0) {
        result.httpOk = true;

        // Try to parse MCP response
        try {
          const body = (await response.json()) as {
            jsonrpc?: string;
            result?: { tools?: { name: string }[] };
            error?: { code?: number; message: string };
          };

          if (body.jsonrpc === "2.0") {
            result.mcpOk = true;

            if (body.result?.tools) {
              result.tools = body.result.tools.map((t) => t.name);
            } else if (body.error) {
              // Auth error or other MCP error - server is working
              result.mcpError = body.error.message;
            }
          }
        } catch {
          // Not JSON, but HTTP works
        }
        break;
      }
    } catch (error) {
      result.httpError =
        error instanceof Error ? error.message : "Connection failed";

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  return result;
}

// ============================================
// Run All Pre-Deploy Checks
// ============================================

export interface PreDeployCheckResult {
  passed: boolean;
  manifestValid: boolean;
  dependenciesOk: boolean;
  buildOk: boolean;
  errors: string[];
  warnings: string[];
}

export async function runPreDeployChecks(
  cwd: string,
  manifest: McpizeManifest,
): Promise<PreDeployCheckResult> {
  const result: PreDeployCheckResult = {
    passed: true,
    manifestValid: true,
    dependenciesOk: true,
    buildOk: true,
    errors: [],
    warnings: [],
  };

  // 1. Validate manifest schema
  const schemaSpinner = ora("Validating mcpize.yaml...").start();
  const schemaResult = validateManifest(manifest);

  if (!schemaResult.valid) {
    schemaSpinner.fail("Invalid mcpize.yaml");
    result.manifestValid = false;
    result.passed = false;
    result.errors.push(...schemaResult.errors);
  } else {
    schemaSpinner.succeed("mcpize.yaml valid");
  }
  result.warnings.push(...schemaResult.warnings);

  // 2. Check dependencies
  const depSpinner = ora("Checking dependencies...").start();
  const depResult = checkDependencies(cwd, manifest.runtime);

  if (!depResult.valid) {
    depSpinner.fail("Missing dependencies");
    result.dependenciesOk = false;
    result.passed = false;
    result.errors.push(...depResult.errors);
  } else if (depResult.warnings.length > 0) {
    depSpinner.warn("Dependency warnings");
  } else {
    depSpinner.succeed("Dependencies found");
  }
  result.warnings.push(...depResult.warnings);

  // 3. Run build check
  const buildSpinner = ora("Running build check...").start();
  const buildResult = runPreBuildCheck(cwd, manifest);

  if (buildResult.skipped) {
    buildSpinner.info("No build script found, skipping");
  } else if (!buildResult.success) {
    buildSpinner.fail("Build failed");
    result.buildOk = false;
    result.passed = false;
    if (buildResult.error) {
      // Truncate long error messages
      const errorMsg =
        buildResult.error.length > 500
          ? buildResult.error.slice(0, 500) + "..."
          : buildResult.error;
      result.errors.push(`Build error: ${errorMsg}`);
    }
  } else {
    buildSpinner.succeed("Build passed");
  }

  return result;
}

// ============================================
// Display Health Check Results
// ============================================

export function displayHealthCheckResult(result: HealthCheckResult): void {
  console.log();

  if (result.httpOk) {
    console.log(chalk.green("✓ HTTP endpoint responding"));
  } else {
    console.log(chalk.red("✗ HTTP endpoint not responding"));
    if (result.httpError) {
      console.log(chalk.dim(`  Error: ${result.httpError}`));
    }
  }

  if (result.mcpOk) {
    console.log(chalk.green("✓ MCP protocol working"));
    if (result.tools && result.tools.length > 0) {
      console.log(
        chalk.dim(
          `  Tools: ${result.tools.slice(0, 5).join(", ")}${result.tools.length > 5 ? ` (+${result.tools.length - 5} more)` : ""}`,
        ),
      );
    }
  } else if (result.httpOk) {
    console.log(chalk.yellow("⚠ MCP protocol check inconclusive"));
    if (result.mcpError) {
      console.log(chalk.dim(`  ${result.mcpError}`));
    }
  }
}
