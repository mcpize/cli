import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as tar from "tar";

// Default patterns to exclude from tarball
const DEFAULT_EXCLUDES = [
  // Package directories
  "node_modules",
  "__pycache__",
  "vendor",
  ".venv",
  "venv",

  // Build artifacts
  "dist",
  "build",
  ".next",
  ".nuxt",

  // Git and IDE
  ".git",
  ".mcpize",
  ".vscode",
  ".idea",
  ".DS_Store",

  // Environment files
  ".env",
  ".env.*",
  "!.env.example",

  // Test and coverage
  "coverage",
  ".nyc_output",

  // Logs
  "*.log",
  "npm-debug.log*",
];

export interface TarballOptions {
  cwd: string;
  excludes?: string[];
}

function loadMcpizeIgnore(cwd: string): string[] {
  const ignorePath = join(cwd, ".mcpizeignore");
  if (!existsSync(ignorePath)) {
    return [];
  }

  const content = readFileSync(ignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function shouldExclude(filePath: string, excludes: string[]): boolean {
  const fileName = filePath.split("/").pop() || "";

  for (const pattern of excludes) {
    // Skip negation patterns in this check
    if (pattern.startsWith("!")) continue;

    // Exact match
    if (filePath === pattern || fileName === pattern) {
      return true;
    }

    // Directory match (pattern without trailing slash matches directory)
    if (filePath.startsWith(pattern + "/")) {
      return true;
    }

    // Simple glob match for *.ext patterns
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1);
      if (fileName.endsWith(ext)) {
        return true;
      }
    }

    // Check if any path segment matches
    const segments = filePath.split("/");
    if (segments.includes(pattern)) {
      return true;
    }
  }

  return false;
}

async function collectFiles(
  dir: string,
  baseDir: string,
  excludes: string[],
): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const files: string[] = [];

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(baseDir, fullPath);

    if (shouldExclude(relativePath, excludes)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, baseDir, excludes);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function createTarball(options: TarballOptions): Promise<Buffer> {
  const { cwd } = options;

  // Combine default excludes with .mcpizeignore
  const customExcludes = loadMcpizeIgnore(cwd);
  const allExcludes = [
    ...DEFAULT_EXCLUDES,
    ...(options.excludes || []),
    ...customExcludes,
  ];

  // Collect all files to include
  const files = await collectFiles(cwd, cwd, allExcludes);

  if (files.length === 0) {
    throw new Error("No files to include in tarball");
  }

  // Create tarball using promise-based approach
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    tar
      .create(
        {
          gzip: true,
          cwd,
          portable: true,
        },
        files,
      )
      .on("data", (chunk: Buffer) => chunks.push(chunk))
      .on("end", () => resolve(Buffer.concat(chunks)))
      .on("error", reject);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
