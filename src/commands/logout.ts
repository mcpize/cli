import chalk from "chalk";
import { clearSession } from "../lib/config.js";

export async function logoutCommand(): Promise<void> {
  console.log(chalk.bold("\nMCPize Logout\n"));

  clearSession();

  console.log(chalk.green("✓ Logged out successfully.\n"));
  console.log(chalk.dim("Run mcpize login to authenticate again.\n"));
}
