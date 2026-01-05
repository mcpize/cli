import type { TunnelProvider, TunnelConnection } from "../types.js";

/**
 * ngrok provider - reliable, paid tunneling service
 *
 * Requires NGROK_AUTHTOKEN environment variable.
 * Get token at: https://dashboard.ngrok.com/get-started/your-authtoken
 *
 * @see https://ngrok.com/docs
 */
export const ngrokProvider: TunnelProvider = {
  name: "ngrok",

  async isAvailable(): Promise<boolean> {
    return !!process.env.NGROK_AUTHTOKEN;
  },

  async connect(_port: number): Promise<TunnelConnection> {
    // TODO: Implement when needed
    // const ngrok = await import('@ngrok/ngrok');
    // const url = await ngrok.connect({
    //   addr: port,
    //   authtoken: process.env.NGROK_AUTHTOKEN
    // });

    throw new Error(
      "ngrok provider is not implemented yet.\n" +
        "For now, use the default localtunnel provider:\n" +
        "  mcpize dev --tunnel",
    );
  },
};
