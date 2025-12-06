import {
  getToken,
  getRefreshToken,
  isTokenExpired,
  setSession,
  clearSession,
  getSupabaseUrl,
  getSupabaseAnonKey,
} from "./config.js";

// Global token override (set via --token flag)
let tokenOverride: string | null = null;

/**
 * Set token override (from --token flag).
 * This takes highest priority over env and file-based tokens.
 */
export function setTokenOverride(token: string): void {
  tokenOverride = token;
}

/**
 * Get token from environment variable.
 * Used for CI/CD environments.
 */
function getEnvToken(): string | null {
  return process.env.MCPIZE_TOKEN || null;
}

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface RefreshError {
  error: string;
  error_description?: string;
}

/**
 * Refresh the access token using the stored refresh token.
 * Returns the new access token or null if refresh failed.
 */
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    return null;
  }

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  try {
    // Supabase Auth API uses JSON body with grant_type in query param
    const response = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
        },
        body: JSON.stringify({
          refresh_token: refreshToken,
        }),
      },
    );

    if (!response.ok) {
      const error = (await response.json()) as RefreshError;
      console.error(
        `Token refresh failed: ${error.error_description || error.error}`,
      );
      return null;
    }

    const data = (await response.json()) as RefreshResponse;

    // Save the new session
    setSession(data.access_token, data.refresh_token, data.expires_in);

    return data.access_token;
  } catch (error) {
    console.error(
      `Token refresh error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Get a valid access token, refreshing if necessary.
 * Priority: --token flag > MCPIZE_TOKEN env > file-based session
 * Returns null if no valid token is available and refresh failed.
 */
export async function getValidToken(): Promise<string | null> {
  // 1. Highest priority: --token flag
  if (tokenOverride) {
    return tokenOverride;
  }

  // 2. Environment variable (for CI/CD)
  const envToken = getEnvToken();
  if (envToken) {
    return envToken;
  }

  // 3. File-based session with auto-refresh
  const token = getToken();

  // No token at all
  if (!token) {
    return null;
  }

  // Token not expired, use it
  if (!isTokenExpired()) {
    return token;
  }

  // Token expired, try to refresh
  const newToken = await refreshAccessToken();

  if (!newToken) {
    // Refresh failed, clear session
    clearSession();
    return null;
  }

  return newToken;
}

/**
 * Check if user is authenticated (has valid or refreshable session).
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getValidToken();
  return token !== null;
}

/**
 * Require authentication. Throws if not authenticated.
 */
export async function requireAuth(): Promise<string> {
  const token = await getValidToken();

  if (!token) {
    throw new Error("Not authenticated. Run: mcpize login");
  }

  return token;
}
