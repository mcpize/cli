/**
 * Tunnel provider interface
 */
export interface TunnelProvider {
  /** Provider name for display */
  name: string;

  /** Check if provider is available (installed, has token, etc.) */
  isAvailable(): Promise<boolean>;

  /** Create tunnel connection */
  connect(port: number): Promise<TunnelConnection>;
}

/**
 * Active tunnel connection
 */
export interface TunnelConnection {
  /** Public URL for the tunnel */
  url: string;

  /** Close the tunnel */
  close(): Promise<void>;
}

/**
 * Supported tunnel providers
 */
export type TunnelProviderType = "localtunnel" | "ngrok" | "cloudflared";
