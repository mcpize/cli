import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";
import chalk from "chalk";
import ora from "ora";
import type { McpizeManifest } from "./project.js";
import { getServerGatewayUrl } from "./config.js";

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
// Port Configuration Check
// ============================================

export interface PortCheckResult {
  valid: boolean;
  warning?: string;
  details?: string;
}

/**
 * Check if server is configured to use PORT environment variable
 * instead of hardcoded port numbers
 */
export function checkPortConfiguration(
  cwd: string,
  runtime: McpizeManifest["runtime"],
): PortCheckResult {
  const result: PortCheckResult = { valid: true };

  try {
    let sourceFiles: string[] = [];
    let portEnvPattern: RegExp;
    let hardcodedPortPattern: RegExp;

    switch (runtime) {
      case "typescript": {
        // Check built JS files if they exist, otherwise check TS source
        const buildDir = join(cwd, "build");
        const distDir = join(cwd, "dist");
        const srcDir = join(cwd, "src");

        if (existsSync(buildDir)) {
          sourceFiles = findFiles(buildDir, /\.(js|mjs)$/);
        } else if (existsSync(distDir)) {
          sourceFiles = findFiles(distDir, /\.(js|mjs)$/);
        } else if (existsSync(srcDir)) {
          sourceFiles = findFiles(srcDir, /\.(ts|js)$/);
        }

        // Pattern for correct PORT usage
        portEnvPattern =
          /process\.env\.PORT|process\.env\["PORT"\]|process\.env\['PORT'\]/;
        // Pattern for hardcoded listen calls without PORT
        hardcodedPortPattern = /\.listen\s*\(\s*(\d{4})\s*[,)]/g;
        break;
      }
      case "python": {
        const srcDir = cwd;
        sourceFiles = findFiles(srcDir, /\.py$/, [
          "venv",
          ".venv",
          "__pycache__",
        ]);

        // Pattern for correct PORT usage in Python
        portEnvPattern =
          /os\.environ\.get\s*\(\s*["']PORT["']|os\.getenv\s*\(\s*["']PORT["']|environ\s*\[\s*["']PORT["']\]/;
        // Pattern for hardcoded port in Python
        hardcodedPortPattern =
          /\.run\s*\([^)]*port\s*=\s*(\d{4})|uvicorn\.run\s*\([^)]*port\s*=\s*(\d{4})/g;
        break;
      }
      default:
        return result; // Skip for unsupported runtimes
    }

    // Look for main entry files first
    const mainFiles = sourceFiles.filter(
      (f) =>
        f.includes("index.") ||
        f.includes("main.") ||
        f.includes("server.") ||
        f.includes("app."),
    );
    const filesToCheck =
      mainFiles.length > 0 ? mainFiles : sourceFiles.slice(0, 10);

    for (const file of filesToCheck) {
      try {
        const content = readFileSync(file, "utf-8");

        // Check for hardcoded port
        const matches = [...content.matchAll(hardcodedPortPattern)];
        if (matches.length > 0) {
          // Check if PORT env is also used in the file
          if (!portEnvPattern.test(content)) {
            const port = matches[0][1] || matches[0][2];
            result.valid = false;
            result.warning = `Hardcoded port ${port} detected. Use process.env.PORT for Cloud Run compatibility`;
            result.details = file.replace(cwd, ".");
            return result;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // If check fails, don't block deploy
  }

  return result;
}

/**
 * Find files matching pattern in directory (recursive)
 */
function findFiles(
  dir: string,
  pattern: RegExp,
  excludeDirs: string[] = ["node_modules", ".git"],
): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          files.push(...findFiles(fullPath, pattern, excludeDirs));
        }
      } else if (entry.isFile() && pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory not readable
  }

  return files;
}

// ============================================
// Environment Variables / Secrets Check
// ============================================

export interface SecretsCheckResult {
  valid: boolean;
  missingSecrets: string[];
  warning?: string;
}

// System env vars that are always available and shouldn't be flagged
const SYSTEM_ENV_VARS = new Set([
  "PORT",
  "NODE_ENV",
  "PATH",
  "HOME",
  "USER",
  "PWD",
  "SHELL",
  "LANG",
  "TERM",
  "HOSTNAME",
  "TZ",
  // Node.js specific
  "NODE_PATH",
  "NODE_OPTIONS",
  // Common CI/CD
  "CI",
  "DEBUG",
]);

/**
 * Check for environment variables used in code that might need to be configured as secrets
 */
export function checkRequiredSecrets(
  cwd: string,
  runtime: McpizeManifest["runtime"],
  configuredSecrets: string[] = [],
): SecretsCheckResult {
  const result: SecretsCheckResult = {
    valid: true,
    missingSecrets: [],
  };

  try {
    let sourceFiles: string[] = [];
    let envVarPatterns: RegExp[];

    switch (runtime) {
      case "typescript": {
        const buildDir = join(cwd, "build");
        const distDir = join(cwd, "dist");
        const srcDir = join(cwd, "src");

        if (existsSync(buildDir)) {
          sourceFiles = findFiles(buildDir, /\.(js|mjs)$/);
        } else if (existsSync(distDir)) {
          sourceFiles = findFiles(distDir, /\.(js|mjs)$/);
        } else if (existsSync(srcDir)) {
          sourceFiles = findFiles(srcDir, /\.(ts|js)$/);
        }

        // Patterns for env var access in JS/TS
        envVarPatterns = [
          /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
          /process\.env\["([A-Z][A-Z0-9_]{2,})"\]/g,
          /process\.env\['([A-Z][A-Z0-9_]{2,})'\]/g,
        ];
        break;
      }
      case "python": {
        sourceFiles = findFiles(cwd, /\.py$/, ["venv", ".venv", "__pycache__"]);

        // Patterns for env var access in Python
        envVarPatterns = [
          /os\.environ\.get\s*\(\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
          /os\.getenv\s*\(\s*["']([A-Z][A-Z0-9_]{2,})["']/g,
          /environ\s*\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g,
        ];
        break;
      }
      default:
        return result;
    }

    const foundEnvVars = new Set<string>();
    const configuredSet = new Set(
      configuredSecrets.map((s) => s.toUpperCase()),
    );

    // Scan source files for env var usage
    for (const file of sourceFiles.slice(0, 20)) {
      // Limit to prevent slowdown
      try {
        const content = readFileSync(file, "utf-8");

        for (const pattern of envVarPatterns) {
          // Reset regex state
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const varName = match[1];
            if (varName && !SYSTEM_ENV_VARS.has(varName)) {
              foundEnvVars.add(varName);
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Check which env vars are not configured as secrets
    for (const envVar of foundEnvVars) {
      if (!configuredSet.has(envVar.toUpperCase())) {
        result.missingSecrets.push(envVar);
      }
    }

    if (result.missingSecrets.length > 0) {
      result.valid = false;
      result.warning = `Potentially missing secrets: ${result.missingSecrets.join(", ")}`;
    }
  } catch {
    // If check fails, don't block deploy
  }

  return result;
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
  const gatewayUrl = getServerGatewayUrl(slug);
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
  portConfigOk: boolean;
  secretsOk: boolean;
  errors: string[];
  warnings: string[];
}

export async function runPreDeployChecks(
  cwd: string,
  manifest: McpizeManifest,
  configuredSecrets: string[] = [],
): Promise<PreDeployCheckResult> {
  const result: PreDeployCheckResult = {
    passed: true,
    manifestValid: true,
    dependenciesOk: true,
    buildOk: true,
    portConfigOk: true,
    secretsOk: true,
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

  // 4. Check port configuration (warning only, doesn't block deploy)
  const portResult = checkPortConfiguration(cwd, manifest.runtime);
  if (!portResult.valid) {
    result.portConfigOk = false;
    result.warnings.push(portResult.warning || "Hardcoded port detected");
    if (portResult.details) {
      result.warnings.push(`  File: ${portResult.details}`);
    }
  }

  // 5. Check for missing secrets (warning only, doesn't block deploy)
  const secretsResult = checkRequiredSecrets(
    cwd,
    manifest.runtime,
    configuredSecrets,
  );
  if (!secretsResult.valid) {
    result.secretsOk = false;
    result.warnings.push(secretsResult.warning || "Missing secrets detected");
    if (secretsResult.missingSecrets.length > 0) {
      result.warnings.push(
        `  Configure with: mcpize secrets set <NAME> <VALUE>`,
      );
    }
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
