import type { TunnelProvider, TunnelConnection } from "../types.js";

/**
 * Cloudflare Tunnel provider - free, reliable tunneling
 *
 * Requires `cloudflared` CLI to be installed:
 *   brew install cloudflared  # macOS
 *   winget install cloudflare.cloudflared  # Windows
 *
 * @see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
 */
export const cloudflaredProvider: TunnelProvider = {
  name: "cloudflared",

  async isAvailable(): Promise<boolean> {
    // TODO: Check if cloudflared CLI is installed
    // const { which } = await import('../utils/which.js');
    // return !!(await which('cloudflared'));
    return false;
  },

  async connect(_port: number): Promise<TunnelConnection> {
    // TODO: Implement when needed
    // const { spawn } = await import('child_process');
    // const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`]);
    // Parse URL from stderr...

    throw new Error(
      "cloudflared provider is not implemented yet.\n" +
        "For now, use the default localtunnel provider:\n" +
        "  mcpize dev --tunnel",
    );
  },
};
