import chalk from "chalk";
import ora from "ora";
import Enquirer from "enquirer";
import {
  getServerStatus,
  getServerSetupStatus,
  generateSEO,
  saveSEO,
  generatePlans,
  markServerAsFree,
  publishServer,
  generateLogo,
  saveLogoUrl,
  cleanServerName,
  saveServerName,
  type GeneratedPlan,
} from "../lib/api.js";
import { getServerPageUrl, getServerManageUrl } from "../lib/config.js";
import { loadManifest } from "../lib/project.js";
import { resolveServerId } from "../lib/command-utils.js";
import { requireAuth } from "../lib/auth.js";
import {
  setupMonetization,
  setupSEO,
} from "../lib/post-deploy-wizard.js";

const { prompt } = Enquirer;

interface PublishOptions {
  server?: string;
  auto?: boolean;
  free?: boolean;
  pricing?: string;
  generateLogo?: boolean;
  generateSeo?: boolean;
  show?: boolean;
  unpublish?: boolean;
  dryRun?: boolean;
}

export async function publishCommand(options: PublishOptions): Promise<void> {
  await requireAuth();
  const serverId = resolveServerId(options);

  // Validate flag conflicts
  if (options.free && options.pricing) {
    console.error(chalk.red("Cannot use --free and --pricing together."));
    process.exit(1);
  }

  const mutationFlags = [
    options.auto,
    options.free,
    options.pricing,
    options.generateLogo,
    options.generateSeo,
  ].some(Boolean);

  if (options.show && options.unpublish) {
    console.error(
      chalk.red("--show and --unpublish cannot be combined."),
    );
    process.exit(1);
  }

  if (options.show && mutationFlags) {
    console.error(chalk.red("--show cannot be combined with other flags."));
    process.exit(1);
  }

  if (options.unpublish && mutationFlags) {
    console.error(
      chalk.red("--unpublish cannot be combined with other flags."),
    );
    process.exit(1);
  }

  // Fetch server info
  const infoSpinner = ora("Fetching server info...").start();
  let serverName: string;
  let serverSlug: string;
  let serverStatus: string;

  try {
    const status = await getServerStatus(serverId);
    serverName = status.server.name;
    serverSlug = status.server.slug;
    serverStatus = status.server.status;
    infoSpinner.stop();
  } catch (error) {
    infoSpinner.fail("Failed to fetch server info");
    throw error;
  }

  // Get description from manifest (local mcpize.yaml) or fallback to name
  const manifest = loadManifest(process.cwd());
  const description = manifest?.description || serverName;

  console.log(chalk.bold("\nMCPize Publish\n"));
  console.log(chalk.dim(`Server: ${serverName} (${serverSlug})`));
  console.log(chalk.dim(`Status: ${serverStatus}\n`));

  // --dry-run: show what would happen without making API calls
  if (options.dryRun) {
    printDryRun(options);
    return;
  }

  // --show: display status and exit
  if (options.show) {
    await showStatus(serverId);
    return;
  }

  // --unpublish: take down from marketplace
  if (options.unpublish) {
    const spinner = ora("Unpublishing from marketplace...").start();
    try {
      await publishServer(serverId, false);
      spinner.succeed("Server unpublished from marketplace");
    } catch (error) {
      spinner.fail("Failed to unpublish");
      throw error;
    }
    return;
  }

  // --auto: smart autopilot — skips steps that are already configured
  if (options.auto) {
    const setupStatus = await getServerSetupStatus(serverId);
    await runAutoPublish(
      serverId,
      serverName,
      serverSlug,
      description,
      options.pricing,
      setupStatus,
    );
    return;
  }

  // Individual flags
  if (options.generateSeo) {
    await runGenerateSEO(serverId, serverName, description);
  }

  if (options.free) {
    const spinner = ora("Marking server as free...").start();
    try {
      await markServerAsFree(serverId);
      spinner.succeed("Server marked as free");
    } catch (error) {
      spinner.fail("Failed to mark as free");
      throw error;
    }
  }

  if (options.pricing) {
    await runGeneratePlans(serverId, serverName, options.pricing);
  }

  if (options.generateLogo) {
    await runGenerateLogo(serverId, serverName, description, serverSlug);
  }

  // If any individual flags were used, we're done
  // (edge function auto-publishes if SEO + plans are both set)
  if (mutationFlags) {
    printSummary(serverSlug, serverId);
    return;
  }

  // No flags: interactive mode
  await runInteractive(serverId, serverName, serverSlug, description);
}

async function showStatus(serverId: string): Promise<void> {
  const spinner = ora("Checking setup status...").start();
  try {
    const status = await getServerSetupStatus(serverId);
    spinner.stop();

    console.log(chalk.bold("Setup Status:"));
    console.log(
      `  SEO content:  ${status.hasSEO ? chalk.green("configured") : chalk.yellow("not configured")}`,
    );
    console.log(
      `  Pricing:      ${status.hasPlans ? chalk.green(`${status.planCount} plan(s)`) : chalk.yellow("not configured")}`,
    );
  } catch (error) {
    spinner.fail("Failed to check status");
    throw error;
  }
}

async function runAutoPublish(
  serverId: string,
  serverName: string,
  serverSlug: string,
  description: string,
  pricingDescription?: string,
  setupStatus?: { hasSEO: boolean; hasPlans: boolean; hasLogo: boolean; planCount: number },
): Promise<void> {
  console.log(chalk.bold("Running smart autopilot...\n"));

  const failures: string[] = [];

  // Step 0: Clean server name (always — it's cheap)
  const nameSpinner = ora("Cleaning server name...").start();
  try {
    const cleaned = await cleanServerName(serverName);
    await saveServerName(serverId, cleaned.displayName);
    serverName = cleaned.displayName;
    nameSpinner.succeed(`Name: ${cleaned.displayName}`);
  } catch (error) {
    nameSpinner.fail("Failed to clean name");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
    failures.push("name cleaning");
  }

  // Step 1: Generate SEO (skip if already configured)
  if (setupStatus?.hasSEO) {
    console.log(chalk.green("  ✓ SEO content: already configured"));
  } else {
    const seoSpinner = ora("Generating SEO content...").start();
    try {
      const seo = await generateSEO(serverName, description);
      await saveSEO(serverId, {
        display_name: seo.display_name,
        category: seo.category,
        short_description: seo.short_description,
        long_description: seo.long_description,
        seo_title: seo.seo_title,
        seo_description: seo.seo_description,
        tags: seo.tags,
      });
      seoSpinner.succeed(
        `SEO saved: ${seo.display_name} [${seo.category}] (${seo.tags.length} tags)`,
      );
    } catch (error) {
      seoSpinner.fail("Failed to generate SEO");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      failures.push("SEO generation");
    }
  }

  // Step 2: Pricing (skip if already has plans and no --pricing override)
  if (pricingDescription) {
    // Explicit --pricing flag always regenerates
    const pricingSpinner = ora("Generating pricing plans...").start();
    try {
      const result = await generatePlans(serverName, pricingDescription, serverId);
      pricingSpinner.succeed(
        `Saved ${result.plans.length} plan(s): ${result.plans.map((p) => p.name).join(", ")}`,
      );
    } catch (error) {
      pricingSpinner.fail("Failed to generate plans");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      failures.push("pricing setup");
    }
  } else if (setupStatus?.hasPlans) {
    console.log(chalk.green(`  ✓ Pricing: ${setupStatus.planCount} plan(s) configured`));
  } else {
    const freeSpinner = ora("Marking server as free...").start();
    try {
      await markServerAsFree(serverId);
      freeSpinner.succeed("Marked as free");
    } catch (error) {
      freeSpinner.fail("Failed to mark as free");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      failures.push("pricing setup");
    }
  }

  // Step 3: Generate logo (skip if already has one)
  if (setupStatus?.hasLogo) {
    console.log(chalk.green("  ✓ Logo: already configured"));
  } else {
    const logoSpinner = ora("Generating logo with AI...").start();
    try {
      const logoResult = await generateLogo(
        serverId,
        serverName,
        description,
        serverSlug,
      );
      if (logoResult.logoUrl) {
        await saveLogoUrl(serverId, logoResult.logoUrl);
        logoSpinner.succeed("Logo generated and saved");
      } else {
        logoSpinner.warn("No logo generated");
      }
    } catch (error) {
      logoSpinner.fail("Failed to generate logo");
      console.error(
        chalk.red(error instanceof Error ? error.message : String(error)),
      );
      failures.push("logo generation");
    }
  }

  // Abort publish if critical steps failed
  if (failures.length > 0) {
    console.log();
    console.error(
      chalk.red(
        `Skipping publish — ${failures.join(", ")} failed. Fix issues and retry.`,
      ),
    );
    process.exit(1);
  }

  // Step 4: Publish
  const pubSpinner = ora("Publishing to marketplace...").start();
  try {
    await publishServer(serverId, true);
    pubSpinner.succeed("Published to marketplace!");
  } catch (error) {
    pubSpinner.fail("Failed to publish");
    throw error;
  }

  printSummary(serverSlug, serverId);
}

async function runGenerateSEO(
  serverId: string,
  serverName: string,
  description: string,
): Promise<void> {
  const spinner = ora("Generating SEO content with AI...").start();
  try {
    const seo = await generateSEO(serverName, description);
    spinner.succeed("Generated SEO content");

    console.log();
    console.log(`  ${chalk.bold("Name:")} ${seo.display_name}`);
    console.log(`  ${chalk.bold("Category:")} ${seo.category}`);
    console.log(`  ${chalk.bold("Tags:")} ${seo.tags.join(", ")}`);
    console.log(
      `  ${chalk.bold("Description:")} ${seo.short_description}`,
    );
    console.log();

    const saveSpinner = ora("Saving SEO content...").start();
    await saveSEO(serverId, {
      display_name: seo.display_name,
      category: seo.category,
      short_description: seo.short_description,
      long_description: seo.long_description,
      seo_title: seo.seo_title,
      seo_description: seo.seo_description,
      tags: seo.tags,
    });
    saveSpinner.succeed("SEO content saved!");
  } catch (error) {
    spinner.fail("Failed to generate SEO");
    throw error;
  }
}

async function runGeneratePlans(
  serverId: string,
  serverName: string,
  pricingDescription: string,
): Promise<void> {
  const spinner = ora("Generating plans with AI...").start();
  try {
    const result = await generatePlans(serverName, pricingDescription, serverId);
    spinner.succeed(`Generated and saved ${result.plans.length} plan(s)`);

    displayPlans(result.plans);
  } catch (error) {
    spinner.fail("Failed to generate plans");
    throw error;
  }
}

async function runGenerateLogo(
  serverId: string,
  serverName: string,
  description: string,
  slug: string,
): Promise<void> {
  const spinner = ora("Generating logo with AI...").start();
  try {
    const result = await generateLogo(serverId, serverName, description, slug);
    if (result.logoUrl) {
      await saveLogoUrl(serverId, result.logoUrl);
      spinner.succeed("Logo generated and saved");
      console.log(chalk.dim(`  URL: ${result.logoUrl}`));
    } else {
      spinner.warn("No logo generated");
    }
  } catch (error) {
    spinner.fail("Failed to generate logo");
    throw error;
  }
}

async function runInteractive(
  serverId: string,
  serverName: string,
  serverSlug: string,
  description: string,
): Promise<void> {
  // Check what's already configured
  const statusSpinner = ora("Checking server configuration...").start();
  let setupStatus;
  try {
    setupStatus = await getServerSetupStatus(serverId);
    statusSpinner.stop();
  } catch (error) {
    statusSpinner.stop();
    console.log(
      chalk.dim(
        `Could not check setup status: ${error instanceof Error ? error.message : "unknown error"}`,
      ),
    );
  }

  console.log(chalk.bold("━".repeat(50)));
  console.log(chalk.bold("Marketplace Listing Setup"));
  console.log("━".repeat(50) + "\n");

  // Step 1: SEO (reuse wizard function)
  if (!setupStatus?.hasSEO) {
    await setupSEO(serverId, serverName, description);
  } else {
    console.log(chalk.dim("SEO content: already configured\n"));
  }

  // Step 2: Monetization (reuse wizard function)
  if (!setupStatus?.hasPlans) {
    await setupMonetization(serverId, serverName);
  } else {
    console.log(chalk.dim(`Pricing: ${setupStatus.planCount} plan(s) configured\n`));
  }

  // Step 3: Logo
  const { genLogo } = await prompt<{ genLogo: boolean }>({
    type: "confirm",
    name: "genLogo",
    message: "Generate AI logo?",
    initial: true,
  });

  if (genLogo) {
    await runGenerateLogo(serverId, serverName, description, serverSlug);
  }

  // Step 4: Publish
  console.log();
  const { doPublish } = await prompt<{ doPublish: boolean }>({
    type: "confirm",
    name: "doPublish",
    message: "Publish to marketplace?",
    initial: true,
  });

  if (doPublish) {
    const pubSpinner = ora("Publishing...").start();
    try {
      await publishServer(serverId, true);
      pubSpinner.succeed("Published to marketplace!");
    } catch (error) {
      pubSpinner.fail("Failed to publish");
      throw error;
    }
  }

  printSummary(serverSlug, serverId);
}

function displayPlans(plans: GeneratedPlan[]): void {
  console.log();
  for (const plan of plans) {
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
}

function printSummary(slug: string, serverId: string): void {
  console.log();
  console.log(chalk.bold("Summary:"));
  console.log(chalk.cyan(`  • View: ${getServerPageUrl(slug)}`));
  console.log(chalk.cyan(`  • Edit: ${getServerManageUrl(serverId)}`));
}

function printDryRun(options: PublishOptions): void {
  console.log(chalk.yellow("Dry run — no changes will be made:\n"));

  const steps: string[] = [];

  if (options.unpublish) {
    steps.push("Unpublish from marketplace");
  } else if (options.auto) {
    steps.push("Clean server name (AI)");
    steps.push("Generate SEO content (AI)");
    steps.push(
      options.pricing
        ? `Generate pricing plans from: "${options.pricing}" (AI)`
        : "Mark server as free",
    );
    steps.push("Generate logo (AI)");
    steps.push("Publish to marketplace");
  } else {
    if (options.generateSeo) steps.push("Generate SEO content (AI)");
    if (options.free) steps.push("Mark server as free");
    if (options.pricing)
      steps.push(`Generate pricing plans from: "${options.pricing}" (AI)`);
    if (options.generateLogo) steps.push("Generate logo (AI)");

    if (steps.length === 0) {
      steps.push("Interactive setup wizard (SEO, pricing, logo, publish)");
    }
  }

  steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step}`);
  });
}
