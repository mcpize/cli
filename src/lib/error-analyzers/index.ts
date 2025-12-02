/**
 * Error Analyzers - Runtime-specific log analysis for deployment failures
 *
 * Architecture:
 * - base.ts: Interfaces and utility functions
 * - common.ts: Patterns shared across all runtimes (container, port, memory)
 * - nodejs.ts: Node.js/TypeScript specific patterns
 * - python.ts: Python specific patterns
 * - (future) php.ts: PHP specific patterns
 */

import type {
  LogEntry,
  RuntimeAnalyzer,
  DeploymentErrorAnalysis,
  ErrorCategory,
  ErrorPattern,
} from "./base.js";
import { applyPatterns } from "./base.js";
import { commonPatterns, envVarPatterns } from "./common.js";
import { nodejsAnalyzer, typescriptAnalyzer } from "./nodejs.js";
import { pythonAnalyzer } from "./python.js";

// Re-export types
export type { LogEntry, DeploymentErrorAnalysis, ErrorCategory };

// Registry of all runtime analyzers
const analyzers: Record<string, RuntimeAnalyzer> = {
  nodejs: nodejsAnalyzer,
  typescript: typescriptAnalyzer,
  python: pythonAnalyzer,
  // Add more runtimes here as needed
};

/**
 * Get the appropriate analyzer for a runtime
 */
export function getAnalyzer(runtime: string): RuntimeAnalyzer {
  const normalizedRuntime = runtime.toLowerCase();
  return analyzers[normalizedRuntime] || nodejsAnalyzer;
}

/**
 * Get summary message based on error category
 */
function getSummary(category: ErrorCategory, runtime: string): string {
  const analyzer = getAnalyzer(runtime);

  switch (category) {
    case "runtime":
      return `Runtime error: ${analyzer.displayName} server crashed on startup`;
    case "startup":
      return "Startup failed: Container didn't respond to health check";
    case "build":
      return `Build error: ${analyzer.displayName} compilation failed`;
    case "config":
      return "Configuration error: Missing required settings";
    default:
      return "Deployment failed";
  }
}

/**
 * Get default suggestions based on error category and runtime
 */
function getDefaultSuggestions(
  category: ErrorCategory,
  runtime: string,
): string[] {
  const suggestions: string[] = [];

  switch (category) {
    case "runtime":
      suggestions.push("Check your code for uncaught exceptions");
      if (runtime === "python") {
        suggestions.push("Test locally with: python main.py");
      } else {
        suggestions.push("Test locally with: npm run start");
      }
      break;

    case "startup":
      suggestions.push("Ensure server starts within 60 seconds");
      suggestions.push("Verify server listens on $PORT (default 8080)");
      if (runtime === "python") {
        suggestions.push("Test locally with: PORT=8080 python main.py");
      } else {
        suggestions.push("Test locally with: PORT=8080 npm run start");
      }
      break;

    case "build":
      if (runtime === "python") {
        suggestions.push("Check requirements.txt for errors");
        suggestions.push("Run: pip install -r requirements.txt");
      } else {
        suggestions.push("Run: npm run build");
        suggestions.push("Fix compilation errors and redeploy");
      }
      break;

    case "config":
      suggestions.push("Check mcpize.yaml configuration");
      suggestions.push("Verify all required secrets are set: mcpize secrets list");
      break;
  }

  return suggestions;
}

/**
 * Analyze deployment failure logs and return structured error information
 *
 * @param logs - Array of log entries from Cloud Logging
 * @param runtime - The runtime of the server (nodejs, python, etc.)
 * @param errorMessage - Optional error message from deployment status
 * @returns Structured error analysis with details and suggestions
 */
export function analyzeDeploymentLogs(
  logs: LogEntry[],
  runtime: string,
  errorMessage?: string,
): DeploymentErrorAnalysis {
  const analyzer = getAnalyzer(runtime);

  // Combine all patterns: common + env vars + runtime-specific
  const allPatterns: ErrorPattern[] = [
    ...commonPatterns,
    ...envVarPatterns,
    ...analyzer.patterns,
  ];

  // Apply patterns to logs
  const { details, suggestions, category } = applyPatterns(logs, allPatterns);

  // Build final analysis
  const analysis: DeploymentErrorAnalysis = {
    category,
    summary: getSummary(category, runtime),
    details,
    suggestions,
  };

  // Add default suggestions if none were found
  if (analysis.suggestions.length === 0) {
    analysis.suggestions = getDefaultSuggestions(category, runtime);
  }

  // If no details found, add raw error excerpts
  if (analysis.details.length === 0 && logs.length > 0) {
    for (const log of logs.slice(0, 5)) {
      if (log.severity === "ERROR") {
        const truncated =
          log.message.length > 300
            ? log.message.substring(0, 300) + "..."
            : log.message;
        analysis.details.push(truncated);
      }
    }
  }

  // Override summary with error message if we couldn't determine category
  if (category === "unknown" && errorMessage) {
    analysis.summary = errorMessage;
  }

  return analysis;
}

/**
 * Format error analysis for console output
 */
export function formatErrorAnalysis(
  analysis: DeploymentErrorAnalysis,
  chalk: {
    red: { bold: (s: string) => string };
    yellow: (s: string) => string;
    cyan: (s: string) => string;
    white: (s: string) => string;
    dim: (s: string) => string;
  },
): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.red.bold(`✖ ${analysis.summary}`));
  lines.push("");

  if (analysis.details.length > 0) {
    lines.push(chalk.yellow("Error details:"));
    for (const detail of analysis.details) {
      // Handle multi-line details
      const detailLines = detail.split("\n").filter((l) => l.trim());
      for (const line of detailLines.slice(0, 5)) {
        lines.push(chalk.dim(`  ${line}`));
      }
    }
    lines.push("");
  }

  if (analysis.suggestions.length > 0) {
    lines.push(chalk.cyan("Suggestions:"));
    for (const suggestion of analysis.suggestions) {
      lines.push(chalk.white(`  → ${suggestion}`));
    }
    lines.push("");
  }

  lines.push(chalk.dim("For full logs: mcpize logs"));

  return lines.join("\n");
}
