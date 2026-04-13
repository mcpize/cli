import chalk from "chalk";
import ora from "ora";
import { getFunctionsUrl } from "../lib/config.js";

export interface SearchOptions {
  limit?: number;
  tag?: string;
  pricing?: string;
  sort?: string;
  json?: boolean;
}

interface DiscoverResult {
  name: string;
  slug: string;
  description: string;
  tags: string[];
  icon_url: string | null;
  pricing: {
    model: string;
    starting_price: string | null;
  };
  install: {
    cli: string;
  };
  url: string;
  tools_count: number;
  rating: number | null;
}

interface DiscoverResponse {
  results: DiscoverResult[];
  total: number;
  query: string;
}

export async function search(
  query: string,
  options: SearchOptions,
): Promise<void> {
  const spinner = ora("Searching marketplace...").start();

  try {
    const params = new URLSearchParams({ q: query });
    if (options.limit) params.set("limit", String(options.limit));
    if (options.tag) params.set("tag", options.tag);
    if (options.pricing) params.set("pricing", options.pricing);
    if (options.sort) params.set("sort", options.sort);

    const url = `${getFunctionsUrl()}/api-discover?${params}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      spinner.fail(
        chalk.red(
          body.error || `Search failed (HTTP ${res.status})`,
        ),
      );
      process.exit(1);
    }

    const data = (await res.json()) as DiscoverResponse;
    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (data.results.length === 0) {
      console.log(chalk.dim(`No servers found for "${query}"`));
      return;
    }

    console.log(
      chalk.bold(`\n  Found ${data.total} server${data.total !== 1 ? "s" : ""} for "${query}"\n`),
    );

    // Column widths
    const nameW = Math.max(
      4,
      ...data.results.map((r) => r.name.length),
    );
    const pricingW = 10;
    const toolsW = 5;

    // Header
    console.log(
      chalk.dim(
        `  ${"NAME".padEnd(nameW)}  ${"PRICING".padEnd(pricingW)}  ${"TOOLS".padEnd(toolsW)}  RATING`,
      ),
    );

    // Rows
    for (const r of data.results) {
      const pricingLabel =
        r.pricing.starting_price || r.pricing.model;
      const ratingLabel = r.rating ? `${r.rating}/5` : chalk.dim("-");
      console.log(
        `  ${chalk.white(r.name.padEnd(nameW))}  ${pricingLabel.padEnd(pricingW)}  ${String(r.tools_count).padEnd(toolsW)}  ${ratingLabel}`,
      );
    }

    // Install hint for top result
    const top = data.results[0];
    console.log(
      `\n  ${chalk.dim("Install:")} ${chalk.cyan(top.install.cli)}`,
    );
    console.log(
      `  ${chalk.dim("Details:")} ${chalk.underline(top.url)}\n`,
    );
  } catch (err) {
    spinner.fail(
      chalk.red(
        err instanceof Error ? err.message : "Search failed",
      ),
    );
    process.exit(1);
  }
}
