import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_DIR = join(homedir(), ".mcpize", "cache");

interface CacheEntry<T> {
  data: T;
  timestamp: number; // Unix timestamp in ms
  ttl: number; // TTL in ms
}

/**
 * TTL values for different cache types
 */
export const CacheTTL = {
  STATUS: 60 * 1000, // 1 minute
  LOGS: 5 * 60 * 1000, // 5 minutes
  TEMPLATES: 24 * 60 * 60 * 1000, // 24 hours
} as const;

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
  }
}

function getCacheFilePath(key: string): string {
  // Sanitize key to be filesystem safe
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(CACHE_DIR, `${safeKey}.json`);
}

/**
 * Get cached data if it exists and is not expired
 */
export function getCache<T>(key: string): { data: T; age: number } | null {
  ensureCacheDir();
  const filePath = getCacheFilePath(key);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(content);

    const now = Date.now();
    const age = now - entry.timestamp;

    // Check if expired
    if (age > entry.ttl) {
      return null;
    }

    return { data: entry.data, age };
  } catch {
    return null;
  }
}

/**
 * Get cached data even if expired (for fallback when offline)
 */
export function getCacheStale<T>(key: string): { data: T; age: number } | null {
  ensureCacheDir();
  const filePath = getCacheFilePath(key);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(content);

    const now = Date.now();
    const age = now - entry.timestamp;

    return { data: entry.data, age };
  } catch {
    return null;
  }
}

/**
 * Set cached data with TTL
 */
export function setCache<T>(key: string, data: T, ttl: number): void {
  ensureCacheDir();
  const filePath = getCacheFilePath(key);

  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    ttl,
  };

  try {
    writeFileSync(filePath, JSON.stringify(entry, null, 2), { mode: 0o600 });
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Format age for display (e.g., "3 minutes ago")
 */
export function formatAge(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

/**
 * Cache keys for different data types
 */
export const CacheKeys = {
  serverStatus: (serverId: string) => `status-${serverId}`,
  serverLogs: (serverId: string, type: string) => `logs-${serverId}-${type}`,
  templates: () => "templates",
} as const;
