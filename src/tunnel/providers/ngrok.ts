import type { TunnelProvider, TunnelConnection } from "../types.js";

/**
 * ngrok provider - reliable tunneling service (official SDK)
 *
 * Requires NGROK_AUTHTOKEN environment variable.
 * Get free token at: https://dashboard.ngrok.com/get-started/your-authtoken
 *
 * Features:
 * - Pure JS, no binary download
 * - Stable URLs during session
 * - Better reliability than localtunnel
 *
 * @see https://ngrok.com/docs/getting-started/javascript
 */
export const ngrokProvider: TunnelProvider = {
  name: "ngrok",

  async isAvailable(): Promise<boolean> {
    return !!process.env.NGROK_AUTHTOKEN;
  },

  async connect(port: number): Promise<TunnelConnection> {
    // Dynamic import to avoid bundling if not used
    const ngrok = await import("@ngrok/ngrok");

    // Create tunnel with authtoken from environment
    const listener = await ngrok.forward({
      addr: port,
      authtoken_from_env: true,
    });

    const url = listener.url();

    if (!url) {
      throw new Error("Failed to get ngrok tunnel URL");
    }

    return {
      url,
      close: async () => {
        await ngrok.disconnect(url);
      },
    };
  },
};
