import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
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

/**
 * Copy directory recursively
 */
function copyDirectory(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip .git, node_modules, dist, build
    if ([".git", "node_modules", "dist", "build"].includes(entry.name)) {
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
 */
function getLocalTemplatesPath(): string | null {
  const devPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../templates",
  );

  if (fs.existsSync(devPath)) {
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
  }

  // Download from GitHub
  const tarballUrl = `https://github.com/${TEMPLATES_REPO}/archive/refs/heads/main.tar.gz`;

  const buffer = await fetchWithRetry(tarballUrl, {
    onProgress: options.onProgress,
  });

  await extractSubfolder(buffer, template, dest);
}

/**
 * Fetch available templates
 */
export async function fetchTemplatesList(): Promise<
  Array<{ name: string; description: string }>
> {
  return [
    {
      name: "typescript/default",
      description: "TypeScript MCP server (recommended)",
    },
    {
      name: "typescript/openapi",
      description: "Generate MCP from OpenAPI spec",
    },
    { name: "typescript/api", description: "REST API proxy template" },
    { name: "python/default", description: "Python FastMCP server" },
  ];
}

/**
 * Clear the templates cache
 */
export function clearCache(): void {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
}
