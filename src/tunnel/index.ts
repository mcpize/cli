import chalk from "chalk";
import type {
  TunnelProvider,
  TunnelConnection,
  TunnelProviderType,
} from "./types.js";
import { localtunnelProvider } from "./providers/localtunnel.js";
import { ngrokProvider } from "./providers/ngrok.js";
import { cloudflaredProvider } from "./providers/cloudflared.js";

export type { TunnelProvider, TunnelConnection, TunnelProviderType };

/**
 * Available tunnel providers
 */
const providers: Record<TunnelProviderType, TunnelProvider> = {
  localtunnel: localtunnelProvider,
  ngrok: ngrokProvider,
  cloudflared: cloudflaredProvider,
};

/**
 * Auto-detect the best available tunnel provider
 * Priority: cloudflared > ngrok > localtunnel
 */
async function detectBestProvider(): Promise<{
  provider: TunnelProvider;
  type: TunnelProviderType;
  isDefault: boolean;
}> {
  // 1. cloudflared - free and reliable
  if (await cloudflaredProvider.isAvailable()) {
    return { provider: cloudflaredProvider, type: "cloudflared", isDefault: false };
  }

  // 2. ngrok - if token configured
  if (await ngrokProvider.isAvailable()) {
    return { provider: ngrokProvider, type: "ngrok", isDefault: false };
  }

  // 3. localtunnel - always available fallback
  return { provider: localtunnelProvider, type: "localtunnel", isDefault: true };
}

/**
 * Create a tunnel to expose local port to the internet
 *
 * @param port - Local port to expose
 * @param providerType - Specific provider to use (optional, auto-detects if not specified)
 * @returns Tunnel connection with public URL
 */
export async function createTunnel(
  port: number,
  providerType?: TunnelProviderType,
): Promise<TunnelConnection> {
  // If specific provider requested
  if (providerType) {
    const provider = providers[providerType];

    if (!provider) {
      throw new Error(
        `Unknown tunnel provider: ${providerType}\n` +
          `Available providers: ${Object.keys(providers).join(", ")}`,
      );
    }

    const available = await provider.isAvailable();
    if (!available) {
      throw new Error(
        `Tunnel provider '${providerType}' is not available.\n` +
          getProviderHint(providerType),
      );
    }

    console.log(chalk.gray(`Using ${provider.name} tunnel provider...`));
    return provider.connect(port);
  }

  // Auto-detect best available provider
  const { provider, type, isDefault } = await detectBestProvider();

  if (isDefault) {
    console.log(
      chalk.yellow("⚠  Using localtunnel (may be unstable occasionally)"),
    );
    console.log(
      chalk.gray("   💡 Install cloudflared for better reliability:"),
    );
    console.log(chalk.gray("      brew install cloudflared\n"));
  } else {
    console.log(chalk.green(`✓ Auto-detected ${type} tunnel provider`));
  }

  return provider.connect(port);
}

/**
 * Get hint message for unavailable provider
 */
function getProviderHint(providerType: TunnelProviderType): string {
  switch (providerType) {
    case "ngrok":
      return (
        "Set NGROK_AUTHTOKEN environment variable.\n" +
        "Get your token at: https://dashboard.ngrok.com/get-started/your-authtoken"
      );
    case "cloudflared":
      return (
        "Install cloudflared CLI:\n" +
        "  macOS: brew install cloudflared\n" +
        "  Windows: winget install cloudflare.cloudflared"
      );
    default:
      return "";
  }
}
