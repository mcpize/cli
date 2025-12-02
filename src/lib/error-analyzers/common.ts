/**
 * Common error patterns shared across all runtimes
 * These patterns detect Cloud Run / container-level issues
 */

import type { ErrorPattern } from "./base.js";

export const commonPatterns: ErrorPattern[] = [
  // Container exit codes
  {
    name: "container-exit",
    match: (msg) => msg.includes("Container called exit("),
    extract: (msg) => {
      const exitMatch = msg.match(/exit\((\d+)\)/);
      const code = exitMatch?.[1] || "unknown";
      return {
        detail: `Container exited with code ${code}`,
        category: "runtime",
      };
    },
  },

  // Startup probe failures
  {
    name: "startup-probe-failed",
    match: (msg) =>
      msg.includes("STARTUP TCP probe failed") ||
      msg.includes("container failed to start"),
    extract: () => ({
      detail: "Container failed to start and listen on port 8080",
      category: "startup",
    }),
  },

  // Port binding issues
  {
    name: "port-binding",
    match: (msg) =>
      (msg.includes("PORT=8080") || msg.includes("port 8080")) &&
      (msg.includes("failed") || msg.includes("timeout")),
    extract: () => ({
      suggestion:
        "Ensure your server listens on PORT environment variable (default 8080)",
      category: "startup",
    }),
  },

  // Timeout issues
  {
    name: "startup-timeout",
    match: (msg) => msg.includes("timeout") && msg.includes("allocated"),
    extract: () => ({
      suggestion:
        "Server took too long to start. Check for blocking operations during startup.",
      category: "startup",
    }),
  },

  // Memory issues
  {
    name: "out-of-memory",
    match: (msg) =>
      msg.includes("out of memory") ||
      msg.includes("OOMKilled") ||
      msg.includes("memory limit"),
    extract: () => ({
      detail: "Container ran out of memory",
      suggestion:
        "Reduce memory usage or increase memory limit in mcpize.yaml",
      category: "runtime",
    }),
  },

  // Permission denied
  {
    name: "permission-denied",
    match: (msg) =>
      msg.includes("permission denied") || msg.includes("EACCES"),
    extract: () => ({
      detail: "Permission denied error",
      suggestion: "Check file permissions in your Dockerfile",
      category: "runtime",
    }),
  },

  // Network errors
  {
    name: "network-error",
    match: (msg) =>
      msg.includes("ECONNREFUSED") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("getaddrinfo"),
    extract: (msg) => {
      const hostMatch = msg.match(/(?:ECONNREFUSED|connect to)\s+([^\s]+)/i);
      return {
        detail: hostMatch
          ? `Network error connecting to ${hostMatch[1]}`
          : "Network connection error",
        suggestion: "Check if external services are accessible",
        category: "runtime",
      };
    },
  },
];

/**
 * Patterns for environment variable issues (common across runtimes)
 */
export const envVarPatterns: ErrorPattern[] = [
  {
    name: "missing-env-var",
    match: (msg) => msg.includes("environment variable"),
    extract: (msg) => {
      // Match uppercase env var names like POKEMON_API_KEY, DATABASE_URL
      const envMatch = msg.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
      const systemVars = ["PORT", "NODE_ENV", "PATH", "HOME", "USER", "PWD"];

      if (envMatch && !systemVars.includes(envMatch[1])) {
        return {
          suggestion: `Set the missing secret: mcpize secrets set ${envMatch[1]} <value>`,
          category: "config",
        };
      }
      return null;
    },
  },
];
