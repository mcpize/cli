/**
 * Node.js / TypeScript specific error patterns
 */

import type { ErrorPattern, RuntimeAnalyzer } from "./base.js";

const nodejsPatterns: ErrorPattern[] = [
  // JavaScript runtime errors with stack trace
  {
    name: "js-runtime-error",
    match: (msg) =>
      msg.includes("Error:") &&
      (msg.includes("at file://") || msg.includes("at Module")),
    extract: (msg) => {
      const errorMatch = msg.match(/Error: ([^\n]+)/);
      const fileMatch = msg.match(/at file:\/\/([^\s]+):(\d+):(\d+)/);

      const details: string[] = [];
      if (errorMatch) {
        details.push(`Runtime Error: ${errorMatch[1]}`);
      }
      if (fileMatch) {
        details.push(`Location: ${fileMatch[1]}:${fileMatch[2]}`);
      }

      return {
        detail: details.join("\n"),
        category: "runtime",
      };
    },
  },

  // Module not found
  {
    name: "module-not-found",
    match: (msg) =>
      msg.includes("Cannot find module") || msg.includes("Module not found"),
    extract: (msg) => {
      const moduleMatch = msg.match(/Cannot find module '([^']+)'/);
      if (moduleMatch) {
        const moduleName = moduleMatch[1];
        // Check if it's a local file or npm package
        if (moduleName.startsWith(".") || moduleName.startsWith("/")) {
          return {
            detail: `Missing file: ${moduleName}`,
            suggestion: "Check if the file exists and path is correct",
            category: "runtime",
          };
        }
        return {
          detail: `Missing module: ${moduleName}`,
          suggestion: `Run: npm install ${moduleName}`,
          category: "runtime",
        };
      }
      return null;
    },
  },

  // TypeScript compilation errors
  {
    name: "typescript-error",
    match: (msg) => msg.includes("TS") && /TS\d+:/.test(msg),
    extract: (msg) => {
      const tsMatch = msg.match(/(TS\d+):\s*(.+)/);
      return {
        detail: tsMatch ? `TypeScript ${tsMatch[1]}: ${tsMatch[2]}` : msg.substring(0, 200),
        suggestion: "Run: npm run build",
        category: "build",
      };
    },
  },

  // Syntax errors
  {
    name: "syntax-error",
    match: (msg) => msg.includes("SyntaxError"),
    extract: (msg) => {
      const syntaxMatch = msg.match(/SyntaxError: ([^\n]+)/);
      return {
        detail: syntaxMatch ? `Syntax Error: ${syntaxMatch[1]}` : "JavaScript syntax error",
        suggestion: "Check your code for syntax errors",
        category: "runtime",
      };
    },
  },

  // TypeError
  {
    name: "type-error",
    match: (msg) => msg.includes("TypeError:"),
    extract: (msg) => {
      const typeMatch = msg.match(/TypeError: ([^\n]+)/);
      return {
        detail: typeMatch ? `Type Error: ${typeMatch[1]}` : "Type error in code",
        category: "runtime",
      };
    },
  },

  // ReferenceError (undefined variable)
  {
    name: "reference-error",
    match: (msg) => msg.includes("ReferenceError:"),
    extract: (msg) => {
      const refMatch = msg.match(/ReferenceError: ([^\n]+)/);
      return {
        detail: refMatch ? `Reference Error: ${refMatch[1]}` : "Undefined variable error",
        category: "runtime",
      };
    },
  },

  // npm install failures
  {
    name: "npm-install-failed",
    match: (msg) =>
      msg.includes("npm ERR!") || msg.includes("npm error"),
    extract: (msg) => {
      if (msg.includes("ERESOLVE")) {
        return {
          detail: "npm dependency resolution failed",
          suggestion: "Try: npm install --legacy-peer-deps",
          category: "build",
        };
      }
      if (msg.includes("ENOENT")) {
        return {
          detail: "npm package not found",
          suggestion: "Check package name in package.json",
          category: "build",
        };
      }
      return {
        detail: "npm install failed",
        suggestion: "Check package.json and try: npm install",
        category: "build",
      };
    },
  },

  // Unhandled promise rejection
  {
    name: "unhandled-rejection",
    match: (msg) => msg.includes("UnhandledPromiseRejection") || msg.includes("unhandled promise"),
    extract: () => ({
      detail: "Unhandled Promise rejection",
      suggestion: "Add error handling to async operations",
      category: "runtime",
    }),
  },
];

export const nodejsAnalyzer: RuntimeAnalyzer = {
  runtime: "nodejs",
  displayName: "Node.js",
  patterns: nodejsPatterns,
};

// Also export for TypeScript runtime (same patterns)
export const typescriptAnalyzer: RuntimeAnalyzer = {
  runtime: "typescript",
  displayName: "TypeScript",
  patterns: nodejsPatterns,
};
