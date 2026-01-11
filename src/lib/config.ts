import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface MCPizeConfig {
  token?: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp in seconds
}

const CONFIG_DIR = join(homedir(), ".mcpize");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): MCPizeConfig {
  ensureConfigDir();

  if (!existsSync(CONFIG_FILE)) {
    return {};
  }

  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as MCPizeConfig;
  } catch {
    return {};
  }
}

/**
 * Save config atomically using write-to-temp-then-rename pattern.
 * This prevents partial writes and file corruption.
 */
export function saveConfig(config: MCPizeConfig): void {
  ensureConfigDir();

  const content = JSON.stringify(config, null, 2);
  const tempFile = join(CONFIG_DIR, `config.${randomBytes(8).toString("hex")}.tmp`);

  try {
    // Write to temp file first
    writeFileSync(tempFile, content, { mode: 0o600 });
    chmodSync(tempFile, 0o600);

    // Atomic rename (on most filesystems)
    renameSync(tempFile, CONFIG_FILE);
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export function getToken(): string | undefined {
  const config = loadConfig();
  return config.token;
}

export function setToken(token: string): void {
  const config = loadConfig();
  config.token = token;
  saveConfig(config);
}

export function clearToken(): void {
  const config = loadConfig();
  delete config.token;
  saveConfig(config);
}

// API URL is now handled through Supabase Functions
// All API calls go through be.mcpize.com/functions/v1

export function getSupabaseUrl(): string {
  return process.env.MCPIZE_SUPABASE_URL || "https://be.mcpize.com";
}

export function getFunctionsUrl(): string {
  // Derive from SUPABASE_URL if FUNCTIONS_URL not explicitly set
  if (process.env.MCPIZE_FUNCTIONS_URL) {
    return process.env.MCPIZE_FUNCTIONS_URL;
  }
  const supabaseUrl = getSupabaseUrl();
  return `${supabaseUrl}/functions/v1`;
}

export function getSupabaseAnonKey(): string {
  // Public anon key - safe to embed
  return (
    process.env.MCPIZE_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5d3Zhb2NxZ3VoaHZwaGhicXV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxMjIzNTksImV4cCI6MjA3NTY5ODM1OX0.x_CISxdW0i3twjkyqFewE8TGucEYRInCFbM_JucpuX8"
  );
}

export function setSession(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): void {
  const config = loadConfig();
  config.token = accessToken;
  config.refreshToken = refreshToken;
  config.expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  saveConfig(config);
}

export function getRefreshToken(): string | undefined {
  const config = loadConfig();
  return config.refreshToken;
}

export function isTokenExpired(): boolean {
  const config = loadConfig();
  if (!config.expiresAt) return true;
  // Consider expired 60 seconds before actual expiry
  return Date.now() / 1000 > config.expiresAt - 60;
}

export function clearSession(): void {
  const config = loadConfig();
  delete config.token;
  delete config.refreshToken;
  delete config.expiresAt;
  saveConfig(config);
}
