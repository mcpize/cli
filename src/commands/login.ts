import chalk from "chalk";
import Enquirer from "enquirer";
import ora from "ora";
import crypto from "node:crypto";
import open from "open";
import {
  setSession,
  clearSession,
  getSupabaseUrl,
  getSupabaseAnonKey,
  getWebAppUrl,
} from "../lib/config.js";
import { findAvailablePort, createCallbackServer } from "../lib/callback-server.js";

const { prompt } = Enquirer;

// Web app URL for browser login (centralized in config)
const WEB_APP_URL = getWebAppUrl();

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

export interface LoginOptions {
  email?: boolean;
}

/**
 * Login via browser (opens mcpize.com, receives callback with tokens)
 */
async function browserLogin(): Promise<void> {
  const port = await findAvailablePort();
  const state = crypto.randomBytes(16).toString("hex");

  const { promise, server } = createCallbackServer(port, {
    expectedState: state,
    validateParams: (params) => {
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) {
        return { valid: false, error: "Missing authentication tokens." };
      }
      return { valid: true };
    },
  });

  const callbackUrl = `http://localhost:${port}/callback`;
  const loginUrl = `${WEB_APP_URL}/auth?cli_callback=${encodeURIComponent(callbackUrl)}&state=${state}`;

  console.log(chalk.dim("\nOpening browser to complete login..."));
  console.log(chalk.dim(`If browser doesn't open, visit:\n${loginUrl}\n`));

  try {
    await open(loginUrl);
  } catch {
    console.log(chalk.yellow("Could not open browser automatically."));
    console.log(chalk.yellow(`Please open this URL manually:\n${loginUrl}\n`));
  }

  const spinner = ora("Waiting for browser authentication...").start();

  const timeoutMs = 5 * 60 * 1000;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Login timed out. Please try again.")), timeoutMs);
  });

  try {
    const params = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);

    spinner.succeed(chalk.green("Login successful!"));

    setSession(
      params.access_token,
      params.refresh_token,
      parseInt(params.expires_in || "3600", 10),
    );

    if (params.email) {
      console.log(chalk.dim(`Logged in as: ${params.email}`));
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
 * Validate token by calling the server
 * Returns true if token is valid, false otherwise
 */
async function validateTokenWithServer(token: string): Promise<boolean> {
  try {
    const supabaseUrl = getSupabaseUrl();

    const response = await fetch(`${supabaseUrl}/functions/v1/hosting-deploy/whoami`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Main login command
 */
export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  console.log(chalk.bold("\nMCPize Login\n"));

  // Check if already logged in - validate with server, not just local check
  const { getValidToken } = await import("../lib/auth.js");
  const token = await getValidToken();

  if (token) {
    // Validate the token actually works with the server
    const isValid = await validateTokenWithServer(token);
    if (isValid) {
      console.log(chalk.green("✓ Already logged in.\n"));
      console.log(chalk.dim("Use mcpize logout first to switch accounts.\n"));
      return;
    }
    // Token exists locally but is invalid on server - clear and re-login
    console.log(chalk.yellow("Session expired. Re-authenticating...\n"));
    clearSession();
  }

  // Use email/password if --email flag is set
  if (options.email) {
    await emailPasswordLogin();
  } else {
    await browserLogin();
  }
}
