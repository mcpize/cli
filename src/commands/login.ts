import chalk from "chalk";
import Enquirer from "enquirer";
import ora from "ora";
import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";
import open from "open";
import {
  setSession,
  clearSession,
  getSupabaseUrl,
  getSupabaseAnonKey,
} from "../lib/config.js";
import { isAuthenticated } from "../lib/auth.js";

const { prompt } = Enquirer;

// Web app URL for browser login
const WEB_APP_URL = process.env.MCPIZE_WEB_URL || "https://mcpize.com";

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user?: {
    email?: string;
  };
}

interface AuthError {
  error?: string;
  error_description?: string;
  msg?: string;
}

interface CallbackTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email?: string;
}

export interface LoginOptions {
  email?: boolean;
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "localhost");
  });
}

/**
 * Find an available port in the given range
 */
async function findAvailablePort(
  start = 54321,
  end = 54340,
): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error("No available ports for callback server");
}

/**
 * Send success HTML response
 */
function sendSuccessResponse(res: http.ServerResponse): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Connection": "close" });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <title>You're in! | MCPize</title>
  <link rel="icon" href="https://mcpize.com/favicon.ico">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 3rem 2rem;
      max-width: 420px;
    }
    .icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 2.5rem;
      box-shadow: 0 8px 32px rgba(139, 92, 246, 0.3);
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
      background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      color: #71717a;
      font-size: 1rem;
      margin: 0 0 2rem;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 1.25rem;
      text-align: left;
    }
    .card-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #71717a;
      margin: 0 0 0.75rem;
    }
    .command {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 0.9rem;
      color: #a78bfa;
      background: rgba(139, 92, 246, 0.1);
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      display: block;
      margin-bottom: 0.5rem;
    }
    .command:last-child { margin-bottom: 0; }
    .footer {
      margin-top: 2rem;
      color: #52525b;
      font-size: 0.85rem;
    }
    .footer a {
      color: #71717a;
      text-decoration: none;
    }
    .footer a:hover { color: #a1a1aa; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🚀</div>
    <h1>You're in!</h1>
    <p class="subtitle">Head back to your terminal — you're all set.</p>

    <div class="card">
      <p class="card-title">Next up</p>
      <code class="command">cd your-project</code>
      <code class="command">mcpize deploy</code>
    </div>

    <p class="footer">
      <a href="https://mcpize.com" target="_blank">mcpize.com</a>
    </p>
  </div>
</body>
</html>`);
}

/**
 * Send error HTML response
 */
function sendErrorResponse(res: http.ServerResponse, error: string): void {
  res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Connection": "close" });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Oops | MCPize</title>
  <link rel="icon" href="https://mcpize.com/favicon.ico">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 3rem 2rem;
      max-width: 420px;
    }
    .icon {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 2.5rem;
      box-shadow: 0 8px 32px rgba(239, 68, 68, 0.3);
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
      background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      color: #71717a;
      font-size: 1rem;
      margin: 0 0 1.5rem;
    }
    .error-box {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      color: #fca5a5;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    .hint {
      color: #52525b;
      font-size: 0.9rem;
    }
    .hint code {
      background: rgba(255, 255, 255, 0.1);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      color: #a1a1aa;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">😅</div>
    <h1>Something went wrong</h1>
    <p class="subtitle">No worries, just try again.</p>
    <div class="error-box">${error}</div>
    <p class="hint">Run <code>mcpize login</code> in your terminal</p>
  </div>
</body>
</html>`);
}

/**
 * Create a local callback server to receive auth tokens
 */
function createCallbackServer(
  port: number,
  expectedState: string,
): { promise: Promise<CallbackTokens>; server: http.Server } {
  let resolvePromise: (tokens: CallbackTokens) => void;
  let rejectPromise: (error: Error) => void;

  const promise = new Promise<CallbackTokens>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Connection": "close" });
      res.end("Not found");
      return;
    }

    // Validate state parameter (CSRF protection)
    const state = url.searchParams.get("state");
    if (state !== expectedState) {
      sendErrorResponse(res, "Invalid state parameter. Please try again.");
      rejectPromise(new Error("Invalid state parameter"));
      return;
    }

    // Check for error from web
    const error = url.searchParams.get("error");
    if (error) {
      sendErrorResponse(res, error);
      rejectPromise(new Error(error));
      return;
    }

    // Extract tokens
    const accessToken = url.searchParams.get("access_token");
    const refreshToken = url.searchParams.get("refresh_token");
    const expiresIn = parseInt(url.searchParams.get("expires_in") || "3600", 10);
    const email = url.searchParams.get("email") || undefined;

    if (!accessToken || !refreshToken) {
      sendErrorResponse(res, "Missing authentication tokens.");
      rejectPromise(new Error("Missing tokens in callback"));
      return;
    }

    // Success!
    sendSuccessResponse(res);
    resolvePromise({ accessToken, refreshToken, expiresIn, email });
  });

  server.listen(port, "localhost");

  return { promise, server };
}

/**
 * Login via browser (opens mcpize.com, receives callback with tokens)
 */
async function browserLogin(): Promise<void> {
  // Find available port
  const port = await findAvailablePort();

  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString("hex");

  // Create callback server
  const { promise, server } = createCallbackServer(port, state);

  // Build login URL
  const callbackUrl = `http://localhost:${port}/callback`;
  const loginUrl = `${WEB_APP_URL}/auth?cli_callback=${encodeURIComponent(callbackUrl)}&state=${state}`;

  console.log(chalk.dim("\nOpening browser to complete login..."));
  console.log(chalk.dim(`If browser doesn't open, visit:\n${loginUrl}\n`));

  // Open browser
  try {
    await open(loginUrl);
  } catch {
    console.log(chalk.yellow("Could not open browser automatically."));
    console.log(chalk.yellow(`Please open this URL manually:\n${loginUrl}\n`));
  }

  // Wait for callback with timeout
  const spinner = ora("Waiting for browser authentication...").start();

  const timeoutMs = 5 * 60 * 1000; // 5 minutes
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Login timed out. Please try again."));
    }, timeoutMs);
  });

  try {
    const tokens = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);

    spinner.succeed(chalk.green("Login successful!"));

    // Save session
    setSession(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

    if (tokens.email) {
      console.log(chalk.dim(`Logged in as: ${tokens.email}`));
    }

    console.log(chalk.dim("\nSession saved to ~/.mcpize/config.json\n"));
    console.log(chalk.dim("Next steps:"));
    console.log(chalk.dim("  1. cd your-mcp-project"));
    console.log(chalk.dim("  2. mcpize deploy\n"));

    server.closeAllConnections();
    server.close();
    process.exit(0);
  } catch (error) {
    spinner.fail(chalk.red("Login failed"));
    server.closeAllConnections();
    server.close();
    throw error;
  }
}

/**
 * Login via email/password (traditional method)
 */
async function emailPasswordLogin(): Promise<void> {
  // Prompt for credentials
  const credentials = await prompt<{ email: string; password: string }>([
    {
      type: "input",
      name: "email",
      message: "Email:",
      validate: (value: string) => {
        if (!value || !value.includes("@")) {
          return "Please enter a valid email";
        }
        return true;
      },
    },
    {
      type: "password",
      name: "password",
      message: "Password:",
      validate: (value: string) => {
        if (!value || value.length < 6) {
          return "Password must be at least 6 characters";
        }
        return true;
      },
    },
  ]);

  const spinner = ora("Authenticating...").start();

  try {
    const supabaseUrl = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();

    const response = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
        },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      },
    );

    if (!response.ok) {
      const error = (await response.json()) as AuthError;
      const errorMessage =
        error.error_description || error.msg || error.error || "Login failed";
      throw new Error(errorMessage);
    }

    const authData = (await response.json()) as AuthResponse;

    // Save session with refresh token
    setSession(
      authData.access_token,
      authData.refresh_token,
      authData.expires_in,
    );

    spinner.succeed(chalk.green("Login successful!"));

    if (authData.user?.email) {
      console.log(chalk.dim(`Logged in as: ${authData.user.email}`));
    }

    console.log(chalk.dim("\nSession saved to ~/.mcpize/config.json"));
    console.log(chalk.dim("Your session will be refreshed automatically.\n"));
    console.log(chalk.dim("Next steps:"));
    console.log(chalk.dim("  1. cd your-mcp-project"));
    console.log(chalk.dim("  2. mcpize deploy\n"));
  } catch (error) {
    spinner.fail(chalk.red("Login failed"));
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    clearSession();
    process.exit(1);
  }
}

/**
 * Main login command
 */
export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  console.log(chalk.bold("\nMCPize Login\n"));

  // Check if already logged in - skip silently
  const authenticated = await isAuthenticated();
  if (authenticated) {
    console.log(chalk.green("✓ Already logged in.\n"));
    console.log(chalk.dim("Use mcpize logout first to switch accounts.\n"));
    return;
  }

  // Use email/password if --email flag is set
  if (options.email) {
    await emailPasswordLogin();
  } else {
    await browserLogin();
  }
}
