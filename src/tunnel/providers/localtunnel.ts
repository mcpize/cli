import type { TunnelProvider, TunnelConnection } from "../types.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Localtunnel provider - free, open-source tunneling
 *
 * Known issues:
 * - Can be unstable (~80% uptime)
 * - 502/404 errors occasionally
 * - URL changes on every restart
 *
 * @see https://github.com/localtunnel/localtunnel
 */
export const localtunnelProvider: TunnelProvider = {
  name: "localtunnel",

  async isAvailable(): Promise<boolean> {
    // Always available as npm dependency
    return true;
  },

  async connect(port: number): Promise<TunnelConnection> {
    // Dynamic import to avoid bundling if not used
    const localtunnel = await import("localtunnel");

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const tunnel = await localtunnel.default({ port });

        // Handle tunnel errors
        tunnel.on("error", (err: Error) => {
          console.error(`Tunnel error: ${err.message}`);
        });

        return {
          url: tunnel.url,
          close: async () => {
            tunnel.close();
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < MAX_RETRIES) {
          console.warn(
            `Tunnel connection failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`,
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    throw new Error(
      `Failed to create tunnel after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    );
  },
};
