import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";
import {
  generatePlans,
  generateSEO,
  savePlans,
  saveSEO,
  getServerSetupStatus,
  markServerAsFree,
  type GeneratedPlan,
  type GeneratedSEO,
} from "./api.js";
import {
  getDeveloperSettingsUrl,
  getServerPageUrl,
  getServerManageUrl,
} from "./config.js";

const { prompt } = Enquirer;

interface WizardOptions {
  serverId: string;
  serverName: string;
  serverSlug: string;
  description?: string;
}

/**
 * Post-deploy setup wizard
 * Checks what's missing (monetization, SEO) and offers to configure
 */
export async function runPostDeployWizard(
  options: WizardOptions,
): Promise<void> {
  const { serverId, serverName, serverSlug, description } = options;

  // Check current setup status
  const statusSpinner = ora("Checking server configuration...").start();
  let setupStatus;
  try {
    setupStatus = await getServerSetupStatus(serverId);
    statusSpinner.stop();
  } catch {
    statusSpinner.stop();
    // If we can't check status, skip wizard silently
    return;
  }

  // If everything is configured, skip wizard
  if (setupStatus.hasPlans && setupStatus.hasSEO) {
    return;
  }

  console.log(chalk.bold("\n" + "━".repeat(50)));
  console.log(chalk.bold("🚀 Server Setup"));
  console.log("━".repeat(50) + "\n");

  let didSetup = false;

  // Step 1: Monetization (if not configured)
  if (!setupStatus.hasPlans) {
    const configured = await setupMonetization(serverId, serverName);
    didSetup = didSetup || configured;
  }

  // Step 2: SEO & Tags (if not configured)
  if (!setupStatus.hasSEO) {
    const configured = await setupSEO(serverId, serverName, description);
    didSetup = didSetup || configured;
  }

  if (didSetup) {
    // Final summary
    console.log("━".repeat(50));
    console.log(chalk.bold.green("✓ Setup complete!\n"));

    // Stripe reminder
    console.log(
      chalk.yellow("⚠ Reminder: Connect Stripe to receive payments"),
    );
    console.log(chalk.dim(`  Visit: ${getDeveloperSettingsUrl()}\n`));
  }

  // Next steps
  console.log(chalk.bold("Next steps:"));
  console.log(chalk.cyan(`  • View: ${getServerPageUrl(serverSlug)}`));
  console.log(
    chalk.cyan(
      `  • Edit: ${getServerManageUrl(serverId)}`,
    ),
  );
}

async function setupMonetization(
  serverId: string,
  serverName: string,
): Promise<boolean> {
  const { setupMoney } = await prompt<{ setupMoney: boolean }>({
    type: "confirm",
    name: "setupMoney",
    message: "Set up monetization?",
    initial: true,
  });

  if (!setupMoney) {
    // Offer to mark server as free instead
    const { makeFree } = await prompt<{ makeFree: boolean }>({
      type: "confirm",
      name: "makeFree",
      message: "Make this server free for everyone?",
      initial: true,
    });

    if (makeFree) {
      const spinner = ora("Marking server as free...").start();
      try {
        await markServerAsFree(serverId);
        spinner.succeed("Server marked as free!");
        console.log(chalk.dim("  Free community servers don't require pricing plans\n"));
        return true;
      } catch (error) {
        spinner.fail("Failed to mark server as free");
        console.error(
          chalk.red(error instanceof Error ? error.message : String(error)),
        );
      }
    }

    console.log(chalk.dim("Skipped monetization setup.\n"));
    return false;
  }

  console.log(chalk.dim("\nExamples:"));
  console.log(chalk.dim('  • "Free 100 req/day, Pro $10/mo 5000 requests"'));
  console.log(chalk.dim('  • "$0.01 per request pay-as-you-go"'));
  console.log(chalk.dim('  • "Free for OSS, $50/mo commercial"\n'));

  const { pricingInput } = await prompt<{ pricingInput: string }>({
    type: "input",
    name: "pricingInput",
    message: "Describe your pricing:",
  });

  if (!pricingInput.trim()) {
    console.log(chalk.dim("Skipped - no pricing provided.\n"));
    return false;
  }

  const spinner = ora("Generating plans with AI...").start();

  try {
    const result = await generatePlans(serverName, pricingInput);
    spinner.succeed(`Generated ${result.plans.length} plan(s)`);

    // Display generated plans
    console.log();
    for (const plan of result.plans) {
      const price =
        plan.price_monthly === 0
          ? chalk.green("Free")
          : chalk.cyan(`$${plan.price_monthly}/mo`);

      const quota = plan.quota_requests
        ? `${plan.quota_requests.toLocaleString()} requests/${plan.quota_type}`
        : "Unlimited";

      console.log(`  • ${chalk.bold(plan.name)} - ${quota}, ${price}`);
    }
    console.log();

    const { savePlansConfirm } = await prompt<{ savePlansConfirm: boolean }>({
      type: "confirm",
      name: "savePlansConfirm",
      message: "Save these plans?",
      initial: true,
    });

    if (savePlansConfirm) {
      const saveSpinner = ora("Saving plans...").start();
      try {
        await savePlans(serverId, result.plans);
        saveSpinner.succeed("Plans saved!");
        console.log();
        return true;
      } catch (error) {
        saveSpinner.fail("Failed to save plans");
        console.error(
          chalk.red(error instanceof Error ? error.message : String(error)),
        );
      }
    } else {
      console.log(chalk.dim("Plans not saved."));
    }
  } catch (error) {
    spinner.fail("Failed to generate plans");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
  }

  console.log();
  return false;
}

async function setupSEO(
  serverId: string,
  serverName: string,
  description?: string,
): Promise<boolean> {
  console.log("━".repeat(50) + "\n");

  const { setupSeoConfirm } = await prompt<{ setupSeoConfirm: boolean }>({
    type: "confirm",
    name: "setupSeoConfirm",
    message: "Generate SEO content & tags?",
    initial: true,
  });

  if (!setupSeoConfirm) {
    console.log(chalk.dim("Skipped SEO setup.\n"));
    return false;
  }

  const spinner = ora("Generating SEO content with AI...").start();

  try {
    const seo = await generateSEO(serverName, description || serverName);
    spinner.succeed("Generated SEO content");

    console.log();
    console.log(`  ${chalk.bold("Name:")} ${seo.display_name}`);
    console.log(`  ${chalk.bold("Category:")} ${seo.category}`);
    console.log(`  ${chalk.bold("Tags:")} ${seo.tags.join(", ")}`);
    console.log(`  ${chalk.bold("Description:")} ${seo.short_description}`);
    console.log();

    const { saveSeoConfirm } = await prompt<{ saveSeoConfirm: boolean }>({
      type: "confirm",
      name: "saveSeoConfirm",
      message: "Save SEO content?",
      initial: true,
    });

    if (saveSeoConfirm) {
      const saveSpinner = ora("Saving SEO content...").start();
      try {
        await saveSEO(serverId, {
          display_name: seo.display_name,
          category: seo.category,
          short_description: seo.short_description,
          long_description: seo.long_description,
          tags: seo.tags,
        });
        saveSpinner.succeed("SEO content saved!");
        console.log();
        return true;
      } catch (error) {
        saveSpinner.fail("Failed to save SEO content");
        console.error(
          chalk.red(error instanceof Error ? error.message : String(error)),
        );
      }
    } else {
      console.log(chalk.dim("SEO content not saved."));
    }
  } catch (error) {
    spinner.fail("Failed to generate SEO content");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
  }

  console.log();
  return false;
}
