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
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
  error_code?: string;
}

/**
 * Refresh the access token using the stored refresh token.
 *
 * IMPORTANT: Supabase uses refresh token rotation - each refresh token
 * can only be used once. This creates a race condition if multiple CLI
 * processes try to refresh simultaneously:
 *
 * 1. Process A reads refresh_token_1, starts refresh
 * 2. Process B reads refresh_token_1, starts refresh
 * 3. Process A succeeds, saves refresh_token_2
 * 4. Process B fails with "Already Used" (token_1 was already used by A)
 *
 * We handle this by:
 * - Detecting "Already Used" and checking if another process refreshed
 * - Using optimistic concurrency when saving (check if token changed)
 *
 * Returns the new access token or null if refresh failed.
 */
async function refreshAccessToken(): Promise<string | null> {
  // Capture the original refresh token BEFORE making the API call
  const originalRefreshToken = getRefreshToken();

  // Check for missing or empty refresh token
  if (!originalRefreshToken || originalRefreshToken.trim() === "") {
    console.error("No refresh token available");
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
          refresh_token: originalRefreshToken,
        }),
      },
    );

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      let isAlreadyUsed = false;

      try {
        const error = (await response.json()) as RefreshError;
        errorMessage =
          error.error_description ||
          error.msg ||
          error.message ||
          error.error ||
          (error.error_code ? `Error code: ${error.error_code}` : errorMessage);

        // Detect "Already Used" error from Supabase
        isAlreadyUsed =
          errorMessage.toLowerCase().includes("already used") ||
          errorMessage.toLowerCase().includes("refresh_token_reuse");
      } catch {
        // Failed to parse JSON, use status code
      }

      // Handle "Already Used" - another process may have refreshed
      if (isAlreadyUsed) {
        // Wait and retry multiple times - another process might be saving new tokens
        for (let retry = 0; retry < 3; retry++) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (retry + 1)));

          const currentRefreshToken = getRefreshToken();

          // If token changed, another process successfully refreshed
          if (currentRefreshToken && currentRefreshToken !== originalRefreshToken) {
            const currentAccessToken = getToken();
            if (currentAccessToken && !isTokenExpired()) {
              return currentAccessToken;
            }
          }
        }

        // Token didn't change after retries - truly invalid
        console.error(`Token refresh failed: ${errorMessage}`);
        console.error("Hint: Your session may have been used elsewhere. Run: mcpize login");
        return null;
      }

      console.error(`Token refresh failed: ${errorMessage}`);
      return null;
    }

    const data = (await response.json()) as RefreshResponse;

    // Optimistic concurrency: Check if another process saved new tokens
    // while we were waiting for our refresh to complete
    const currentRefreshToken = getRefreshToken();

    if (currentRefreshToken && currentRefreshToken !== originalRefreshToken) {
      // Another process refreshed while we were waiting
      // Their tokens are valid (and ours might cause issues if we overwrite)
      // Use their access token if it's still valid
      const currentAccessToken = getToken();
      if (currentAccessToken && !isTokenExpired()) {
        return currentAccessToken;
      }
      // Their token is already expired, use ours
    }

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
    // Refresh failed - DON'T clear session automatically!
    // Another process might have saved valid tokens, or user might want to retry.
    // User can explicitly run "mcpize logout" if they want to clear.
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
