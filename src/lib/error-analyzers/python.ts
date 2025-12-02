/**
 * Python specific error patterns
 */

import type { ErrorPattern, RuntimeAnalyzer } from "./base.js";

const pythonPatterns: ErrorPattern[] = [
  // ModuleNotFoundError
  {
    name: "module-not-found",
    match: (msg) => msg.includes("ModuleNotFoundError") || msg.includes("No module named"),
    extract: (msg) => {
      const moduleMatch = msg.match(/No module named '([^']+)'/);
      if (moduleMatch) {
        const moduleName = moduleMatch[1].split(".")[0]; // Get base module name
        return {
          detail: `Missing module: ${moduleName}`,
          suggestion: `Run: pip install ${moduleName}`,
          category: "runtime",
        };
      }
      return {
        detail: "Python module not found",
        suggestion: "Check requirements.txt and run: pip install -r requirements.txt",
        category: "runtime",
      };
    },
  },

  // ImportError
  {
    name: "import-error",
    match: (msg) => msg.includes("ImportError:"),
    extract: (msg) => {
      const importMatch = msg.match(/ImportError: ([^\n]+)/);
      return {
        detail: importMatch ? `Import Error: ${importMatch[1]}` : "Python import error",
        suggestion: "Check your imports and installed packages",
        category: "runtime",
      };
    },
  },

  // SyntaxError
  {
    name: "syntax-error",
    match: (msg) => msg.includes("SyntaxError:"),
    extract: (msg) => {
      const syntaxMatch = msg.match(/SyntaxError: ([^\n]+)/);
      const fileMatch = msg.match(/File "([^"]+)", line (\d+)/);

      const details: string[] = [];
      if (syntaxMatch) {
        details.push(`Syntax Error: ${syntaxMatch[1]}`);
      }
      if (fileMatch) {
        details.push(`Location: ${fileMatch[1]}:${fileMatch[2]}`);
      }

      return {
        detail: details.join("\n") || "Python syntax error",
        suggestion: "Check your Python code for syntax errors",
        category: "runtime",
      };
    },
  },

  // IndentationError
  {
    name: "indentation-error",
    match: (msg) => msg.includes("IndentationError:"),
    extract: (msg) => {
      const fileMatch = msg.match(/File "([^"]+)", line (\d+)/);
      return {
        detail: fileMatch
          ? `Indentation Error at ${fileMatch[1]}:${fileMatch[2]}`
          : "Python indentation error",
        suggestion: "Check indentation (use consistent spaces or tabs)",
        category: "runtime",
      };
    },
  },

  // TypeError
  {
    name: "type-error",
    match: (msg) => msg.includes("TypeError:") && !msg.includes("JavaScript"),
    extract: (msg) => {
      const typeMatch = msg.match(/TypeError: ([^\n]+)/);
      return {
        detail: typeMatch ? `Type Error: ${typeMatch[1]}` : "Python type error",
        category: "runtime",
      };
    },
  },

  // NameError (undefined variable)
  {
    name: "name-error",
    match: (msg) => msg.includes("NameError:"),
    extract: (msg) => {
      const nameMatch = msg.match(/NameError: name '([^']+)' is not defined/);
      return {
        detail: nameMatch
          ? `Undefined variable: ${nameMatch[1]}`
          : "Python name error - undefined variable",
        category: "runtime",
      };
    },
  },

  // AttributeError
  {
    name: "attribute-error",
    match: (msg) => msg.includes("AttributeError:"),
    extract: (msg) => {
      const attrMatch = msg.match(/AttributeError: ([^\n]+)/);
      return {
        detail: attrMatch ? `Attribute Error: ${attrMatch[1]}` : "Python attribute error",
        category: "runtime",
      };
    },
  },

  // KeyError
  {
    name: "key-error",
    match: (msg) => msg.includes("KeyError:"),
    extract: (msg) => {
      const keyMatch = msg.match(/KeyError: '?([^'\n]+)'?/);
      return {
        detail: keyMatch ? `Missing key: ${keyMatch[1]}` : "Python key error",
        category: "runtime",
      };
    },
  },

  // pip install failures
  {
    name: "pip-install-failed",
    match: (msg) => msg.includes("pip") && msg.includes("error"),
    extract: (msg) => {
      if (msg.includes("Could not find a version")) {
        const pkgMatch = msg.match(/Could not find a version that satisfies the requirement ([^\s]+)/);
        return {
          detail: pkgMatch ? `Package not found: ${pkgMatch[1]}` : "pip package not found",
          suggestion: "Check package name in requirements.txt",
          category: "build",
        };
      }
      return {
        detail: "pip install failed",
        suggestion: "Check requirements.txt",
        category: "build",
      };
    },
  },

  // Traceback indicator
  {
    name: "traceback",
    match: (msg) => msg.includes("Traceback (most recent call last)"),
    extract: () => ({
      category: "runtime",
      // Don't add detail here, let other patterns handle specific errors
    }),
  },
];

export const pythonAnalyzer: RuntimeAnalyzer = {
  runtime: "python",
  displayName: "Python",
  patterns: pythonPatterns,
};
