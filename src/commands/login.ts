import chalk from "chalk";
import Enquirer from "enquirer";
import ora from "ora";
import {
  setSession,
  clearSession,
  getSupabaseUrl,
  getSupabaseAnonKey,
} from "../lib/config.js";
import { isAuthenticated } from "../lib/auth.js";

const { prompt } = Enquirer;

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

export async function loginCommand(): Promise<void> {
  console.log(chalk.bold("\nMCPize Login\n"));

  // Check if already logged in
  const authenticated = await isAuthenticated();
  if (authenticated) {
    console.log(chalk.green("✓ Already logged in.\n"));

    const response = await prompt<{ relogin: boolean }>({
      type: "confirm",
      name: "relogin",
      message: "Do you want to login with a different account?",
      initial: false,
    });

    if (!response.relogin) {
      return;
    }
  }

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
