/**
 * Base interfaces for runtime-specific error analyzers
 */

export interface LogEntry {
  timestamp: string;
  severity: string;
  message: string;
  insertId: string;
  labels?: Record<string, string>;
}

export interface PatternMatch {
  detail?: string;
  suggestion?: string;
  category?: ErrorCategory;
}

export type ErrorCategory = "runtime" | "startup" | "build" | "config" | "unknown";

export interface ErrorPattern {
  /** Human-readable name for this pattern */
  name: string;
  /** Check if this pattern matches the log message */
  match: (msg: string) => boolean;
  /** Extract details and suggestions from the message */
  extract: (msg: string) => PatternMatch | null;
}

export interface RuntimeAnalyzer {
  /** Runtime identifier (nodejs, python, php, etc.) */
  runtime: string;
  /** Display name for error messages */
  displayName: string;
  /** Runtime-specific error patterns */
  patterns: ErrorPattern[];
}

export interface DeploymentErrorAnalysis {
  category: ErrorCategory;
  summary: string;
  details: string[];
  suggestions: string[];
}

/**
 * Apply patterns to log messages and collect matches
 */
export function applyPatterns(
  logs: LogEntry[],
  patterns: ErrorPattern[],
): { details: string[]; suggestions: string[]; category: ErrorCategory } {
  const details: string[] = [];
  const suggestions: string[] = [];
  let category: ErrorCategory = "unknown";

  for (const log of logs) {
    const msg = log.message;

    for (const pattern of patterns) {
      if (pattern.match(msg)) {
        const result = pattern.extract(msg);
        if (result) {
          if (result.detail) {
            details.push(result.detail);
          }
          if (result.suggestion) {
            suggestions.push(result.suggestion);
          }
          if (result.category) {
            // More specific categories take precedence
            if (category === "unknown" || result.category !== "unknown") {
              category = result.category;
            }
          }
        }
      }
    }
  }

  return {
    details: [...new Set(details)],
    suggestions: [...new Set(suggestions)],
    category,
  };
}
