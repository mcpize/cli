import { spawn, type ChildProcess } from "node:child_process";
import type { TunnelProvider, TunnelConnection } from "../types.js";

const STARTUP_TIMEOUT_MS = 30000;

/**
 * Cloudflare Tunnel provider - free, reliable tunneling
 *
 * Requires `cloudflared` CLI to be installed:
 *   macOS: brew install cloudflared
 *   Windows: winget install cloudflare.cloudflared
 *   Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
 *
 * Features:
 * - Free without limits (trycloudflare.com)
 * - No account needed for quick tunnels
 * - More stable than localtunnel
 *
 * @see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
 */
export const cloudflaredProvider: TunnelProvider = {
  name: "cloudflared",

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("cloudflared", ["--version"], {
        stdio: "ignore",
        shell: true,
      });

      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));

      // Timeout
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  },

  async connect(port: number): Promise<TunnelConnection> {
    return new Promise((resolve, reject) => {
      const proc: ChildProcess = spawn(
        "cloudflared",
        ["tunnel", "--url", `http://localhost:${port}`],
        {
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
        },
      );

      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error("Cloudflared tunnel startup timeout"));
        }
      }, STARTUP_TIMEOUT_MS);

      // URL appears in stderr (cloudflared logs to stderr)
      proc.stderr?.on("data", (data: Buffer) => {
        if (resolved) return;

        const output = data.toString();

        // Look for the trycloudflare.com URL
        const match = output.match(
          /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
        );

        if (match) {
          resolved = true;
          clearTimeout(timeout);

          resolve({
            url: match[0],
            close: async () => {
              proc.kill("SIGTERM");
            },
          });
        }
      });

      proc.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to start cloudflared: ${err.message}`));
        }
      });

      proc.on("close", (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(
            new Error(`Cloudflared exited unexpectedly with code ${code}`),
          );
        }
      });
    });
  },
};
