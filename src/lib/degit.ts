import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";
import { extract } from "tar";

// GitHub repo for templates
const TEMPLATES_REPO = "mcpize/templates";

// Cache directory
const CACHE_DIR = path.join(os.homedir(), ".mcpize", "templates-cache");

// Retry config
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
};

export interface DownloadOptions {
  force?: boolean;
  onProgress?: (downloaded: number, total: number | null) => void;
}

/**
 * Download with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: {
    onProgress?: (downloaded: number, total: number | null) => void;
  } = {},
): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "mcpize-cli",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : null;

      // Read response with progress
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const chunks: Uint8Array[] = [];
      let downloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        downloaded += value.length;

        if (options.onProgress) {
          options.onProgress(downloaded, total);
        }
      }

      // Combine chunks
      const buffer = Buffer.concat(chunks);
      return buffer;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if offline
      if (
        lastError.message.includes("ENOTFOUND") ||
        lastError.message.includes("ENETUNREACH") ||
        lastError.message.includes("fetch failed")
      ) {
        throw new Error(
          "Cannot connect to GitHub. Check your internet connection and try again.",
        );
      }

      // Retry with exponential backoff
      if (attempt < RETRY_CONFIG.maxAttempts - 1) {
        const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Download failed");
}

/**
 * Extract a subfolder from tarball to destination
 */
async function extractSubfolder(
  tarballBuffer: Buffer,
  subfolder: string,
  dest: string,
): Promise<void> {
  // Create temp file for tarball
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpize-"));
  const tarPath = path.join(tempDir, "template.tar.gz");

  try {
    // Write buffer to temp file
    fs.writeFileSync(tarPath, tarballBuffer);

    // Extract tarball
    const extractDir = path.join(tempDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    await extract({
      file: tarPath,
      cwd: extractDir,
    });

    // Find the extracted folder (GitHub adds repo-branch prefix)
    const entries = fs.readdirSync(extractDir);
    if (entries.length !== 1) {
      throw new Error("Unexpected tarball structure");
    }

    const repoRoot = path.join(extractDir, entries[0]);
    const sourceDir = path.join(repoRoot, subfolder);

    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Template folder "${subfolder}" not found in repository`);
    }

    // Copy to destination
    fs.mkdirSync(dest, { recursive: true });
    copyDirectory(sourceDir, dest);
  } finally {
    // Cleanup temp files
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Entries never copied into a new project
const SKIP_ENTRIES = [
  ".git",
  ".env", // local secrets in a templates checkout (.env.example is kept)
  "node_modules",
  "dist",
  "build",
  ".venv",
  "vendor",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
];

/**
 * Copy directory recursively
 */
function copyDirectory(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip VCS metadata, local .env, installed dependencies, build output and caches
    // (a local templates checkout may contain them; the GitHub tarball never does)
    if (SKIP_ENTRIES.includes(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Get local templates path (for development fallback)
 *
 * MCPIZE_TEMPLATES_DIR points at a local checkout of mcpize/templates.
 * Otherwise a sibling checkout is used when the CLI runs from the monorepo
 * (cli/dist/lib or cli/src/lib -> ../../../templates).
 */
function getLocalTemplatesPath(): string | null {
  const envPath = process.env.MCPIZE_TEMPLATES_DIR;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`MCPIZE_TEMPLATES_DIR not found: ${resolved}`);
    }
    return resolved;
  }

  const devPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../templates",
  );

  // Only a real mcpize/templates checkout, not any folder named "templates"
  if (fs.existsSync(path.join(devPath, "typescript/default/template.config.json"))) {
    return devPath;
  }

  return null;
}

/**
 * Download a template from GitHub
 * Falls back to local templates in development
 *
 * @param template - Template path (e.g., "typescript/default")
 * @param dest - Destination directory
 * @param options - Download options
 */
export async function downloadTemplate(
  template: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<void> {
  // Try local templates first (development mode)
  const localPath = getLocalTemplatesPath();
  if (localPath) {
    const templatePath = path.join(localPath, template);
    if (fs.existsSync(templatePath)) {
      fs.mkdirSync(dest, { recursive: true });
      copyDirectory(templatePath, dest);
      return;
    }
    if (process.env.MCPIZE_TEMPLATES_DIR) {
      throw new Error(`Template folder "${template}" not found in ${localPath}`);
    }
  }

  // Download from GitHub
  const tarballUrl = `https://github.com/${TEMPLATES_REPO}/archive/refs/heads/main.tar.gz`;

  const buffer = await fetchWithRetry(tarballUrl, {
    onProgress: options.onProgress,
  });

  await extractSubfolder(buffer, template, dest);
}

export interface TemplateInfo {
  name: string;
  description: string;
}

/**
 * Templates published in mcpize/templates (each folder has a template.config.json).
 * Used when no local templates checkout is available. Keep in sync with the repo.
 */
const KNOWN_TEMPLATES: TemplateInfo[] = [
  {
    name: "typescript/default",
    description: "TypeScript MCP server with @modelcontextprotocol/sdk (recommended)",
  },
  {
    name: "typescript/billing-events",
    description: "TypeScript MCP server with event billing",
  },
  {
    name: "typescript/openapi",
    description: "Generate MCP server from OpenAPI specification",
  },
  { name: "python/default", description: "Python MCP server with FastMCP" },
  {
    name: "python/openapi",
    description: "Generate Python MCP server from OpenAPI specification using FastMCP",
  },
  { name: "php/default", description: "PHP MCP server with the official mcp/sdk" },
];

/**
 * Read templates from a local checkout: every <language>/<name>/template.config.json
 */
function readLocalTemplates(root: string): TemplateInfo[] {
  const templates: TemplateInfo[] = [];

  for (const lang of fs.readdirSync(root, { withFileTypes: true })) {
    if (!lang.isDirectory() || lang.name.startsWith(".")) continue;

    for (const tpl of fs.readdirSync(path.join(root, lang.name), {
      withFileTypes: true,
    })) {
      if (!tpl.isDirectory()) continue;
      const configPath = path.join(root, lang.name, tpl.name, "template.config.json");
      if (!fs.existsSync(configPath)) continue;

      let description = "";
      try {
        description =
          JSON.parse(fs.readFileSync(configPath, "utf-8")).description ?? "";
      } catch {
        // Keep the template, just without a description
      }
      templates.push({ name: `${lang.name}/${tpl.name}`, description });
    }
  }

  // Same order as the published list (known first), then anything new
  const rank = (name: string) => {
    const i = KNOWN_TEMPLATES.findIndex((t) => t.name === name);
    return i === -1 ? KNOWN_TEMPLATES.length : i;
  };
  return templates.sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
  );
}

/**
 * Fetch available templates
 * Uses the local templates checkout when present (development), otherwise the
 * known list of templates published in mcpize/templates.
 */
export async function fetchTemplatesList(): Promise<TemplateInfo[]> {
  const localPath = getLocalTemplatesPath();
  if (localPath) {
    const local = readLocalTemplates(localPath);
    if (local.length > 0) return local;
  }

  return KNOWN_TEMPLATES;
}

/**
 * Clear the templates cache
 */
export function clearCache(): void {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
}
