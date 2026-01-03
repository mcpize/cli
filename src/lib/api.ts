import { getFunctionsUrl } from "./config.js";
import { getValidToken } from "./auth.js";

export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body?: unknown,
    public isRetryable: boolean = false,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public code: string,
    public isRetryable: boolean = true,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Retry configuration for network requests
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1s, 2s, 4s exponential
  retryableErrors: [
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "UND_ERR_CONNECT_TIMEOUT",
  ],
  retryableStatusCodes: [429, 503, 504],
  nonRetryableStatusCodes: [401, 403, 404, 422],
};

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof APIError) {
    return RETRY_CONFIG.retryableStatusCodes.includes(error.statusCode);
  }
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && RETRY_CONFIG.retryableErrors.includes(code)) {
      return true;
    }
    // Check for fetch errors
    if (
      error.message.includes("fetch failed") ||
      error.message.includes("network")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { onRetry?: (attempt: number, delay: number) => void } = {},
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry non-retryable errors
      if (!isRetryableError(error)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === RETRY_CONFIG.maxAttempts) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);

      if (options.onRetry) {
        options.onRetry(attempt, delay);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Wrap a network error with more context
 */
function wrapNetworkError(error: unknown): never {
  if (error instanceof APIError || error instanceof NetworkError) {
    throw error;
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const code = (err as NodeJS.ErrnoException).code || "UNKNOWN";

  let message: string;
  let isRetryable = false;

  if (code === "ENOTFOUND" || err.message.includes("getaddrinfo")) {
    message = "Cannot connect to MCPize API. Check your internet connection.";
    isRetryable = true;
  } else if (code === "ETIMEDOUT" || err.message.includes("timeout")) {
    message = "Request timed out. Please try again.";
    isRetryable = true;
  } else if (code === "ECONNREFUSED") {
    message = "Connection refused. The service may be temporarily unavailable.";
    isRetryable = true;
  } else if (code === "ECONNRESET") {
    message = "Connection was reset. Please try again.";
    isRetryable = true;
  } else if (err.message.includes("fetch failed")) {
    message = "Network request failed. Check your internet connection.";
    isRetryable = true;
  } else {
    message = err.message;
  }

  throw new NetworkError(message, code, isRetryable);
}

export interface UploadResponse {
  upload_id: string;
  storage_path: string;
  size_bytes: number;
  expires_at: string;
}

export interface DeployResponse {
  deployment_id: string;
  status: string;
  build_id: string;
  log_url?: string;
  dashboard_url: string;
}

export interface StatusResponse {
  deployment_id: string;
  status: "pending" | "building" | "deploying" | "success" | "failed";
  build_id?: string;
  service_url?: string;
  error?: string;
  started_at: string;
  completed_at?: string;
}

export interface ServerInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  repo_full_name?: string;
  branch?: string;
  hosting_url?: string;
}

export interface CreateServerRequest {
  name: string;
  slug?: string;
  description?: string;
  repo_full_name?: string;
  branch?: string;
}

async function edgeFunctionRequest<T>(
  functionName: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getValidToken();

  if (!token) {
    throw new Error("Not authenticated. Run: mcpize login");
  }

  const url = `${getFunctionsUrl()}/${functionName}/${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  } catch (error) {
    wrapNetworkError(error);
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    // Handle auth errors with clear message
    if (response.status === 401) {
      throw new AuthError("Session expired or invalid. Run: mcpize login");
    }

    const errorMessage =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error: string }).error
        : `Request failed: ${response.status} ${response.statusText}`;

    const isRetryable = RETRY_CONFIG.retryableStatusCodes.includes(
      response.status,
    );
    throw new APIError(errorMessage, response.status, body, isRetryable);
  }

  return response.json() as Promise<T>;
}

export async function uploadTarball(
  serverId: string,
  tarballBuffer: Buffer,
  _gitSha?: string,
): Promise<UploadResponse> {
  const token = await getValidToken();

  if (!token) {
    throw new Error("Not authenticated. Run: mcpize login");
  }

  // Upload directly to Edge Function with binary body
  const url = `${getFunctionsUrl()}/hosting-deploy/upload?server_id=${encodeURIComponent(serverId)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/gzip",
    },
    body: tarballBuffer,
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    const errorMessage =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error: string }).error
        : `Upload failed: ${response.status} ${response.statusText}`;

    throw new APIError(errorMessage, response.status, body);
  }

  return response.json() as Promise<UploadResponse>;
}

export async function triggerDeploy(
  serverId: string,
  uploadId: string,
  options: {
    gitSha?: string;
    gitBranch?: string;
    gitAuthor?: string;
    gitMessage?: string;
    notes?: string;
  } = {},
): Promise<DeployResponse> {
  return edgeFunctionRequest<DeployResponse>("hosting-deploy", "trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      server_id: serverId,
      upload_id: uploadId,
      git_sha: options.gitSha,
      git_branch: options.gitBranch,
      git_author: options.gitAuthor,
      git_message: options.gitMessage,
      notes: options.notes,
      trigger_source: "cli",
    }),
  });
}

export async function getDeploymentStatus(
  deploymentId: string,
): Promise<StatusResponse> {
  return edgeFunctionRequest<StatusResponse>(
    "hosting-deploy",
    `status?deployment_id=${encodeURIComponent(deploymentId)}`,
    { method: "GET" },
  );
}

export async function getServer(serverId: string): Promise<ServerInfo> {
  return edgeFunctionRequest<ServerInfo>(
    "hosting-deploy",
    `servers?id=${encodeURIComponent(serverId)}`,
    { method: "GET" },
  );
}

export async function listServers(): Promise<ServerInfo[]> {
  return edgeFunctionRequest<ServerInfo[]>("hosting-deploy", "servers", {
    method: "GET",
  });
}

export async function findServerByRepo(
  repoFullName: string,
): Promise<ServerInfo | null> {
  const servers = await edgeFunctionRequest<ServerInfo[]>(
    "hosting-deploy",
    `servers?repo=${encodeURIComponent(repoFullName)}`,
    { method: "GET" },
  );
  return servers.length > 0 ? servers[0] : null;
}

export async function createServer(
  data: CreateServerRequest,
): Promise<ServerInfo> {
  return edgeFunctionRequest<ServerInfo>("hosting-deploy", "servers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
}

export interface UserInfo {
  id: string;
  email: string;
}

export async function getCurrentUser(): Promise<UserInfo> {
  return edgeFunctionRequest<UserInfo>("hosting-deploy", "whoami", {
    method: "GET",
  });
}

export interface PublishResponse {
  id: string;
  name: string;
  slug: string;
  status: string;
  url?: string;
  hosting_url?: string;
}

export async function publishServer(
  serverId: string,
  publish: boolean,
): Promise<PublishResponse> {
  return edgeFunctionRequest<PublishResponse>("hosting-deploy", "publish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      server_id: serverId,
      publish,
    }),
  });
}

export async function getServerInfo(
  serverId: string,
): Promise<PublishResponse> {
  return edgeFunctionRequest<PublishResponse>(
    "hosting-deploy",
    `server?server_id=${encodeURIComponent(serverId)}`,
    { method: "GET" },
  );
}

// Secrets API

export interface SecretInfo {
  id: string;
  name: string;
  environment: string;
  required: boolean;
  created_at: string;
  updated_at: string;
}

export interface SecretWithValue {
  name: string;
  value: string;
  required: boolean;
}

export async function listSecrets(
  serverId: string,
  environment = "production",
): Promise<SecretInfo[]> {
  const result = await edgeFunctionRequest<{ secrets: SecretInfo[] }>(
    "hosting-deploy",
    `secrets?server_id=${encodeURIComponent(serverId)}&environment=${encodeURIComponent(environment)}`,
    { method: "GET" },
  );
  return result.secrets;
}

export async function setSecret(
  serverId: string,
  name: string,
  value: string,
  options: { environment?: string; required?: boolean } = {},
): Promise<SecretInfo> {
  const result = await edgeFunctionRequest<{ secret: SecretInfo }>(
    "hosting-deploy",
    "secrets",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        name,
        value,
        environment: options.environment || "production",
        required: options.required,
      }),
    },
  );
  return result.secret;
}

export async function deleteSecret(
  serverId: string,
  name: string,
  environment = "production",
): Promise<void> {
  await edgeFunctionRequest<{ success: boolean }>("hosting-deploy", "secrets", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      server_id: serverId,
      name,
      environment,
    }),
  });
}

export async function exportSecrets(
  serverId: string,
  environment = "production",
): Promise<SecretWithValue[]> {
  const result = await edgeFunctionRequest<{ secrets: SecretWithValue[] }>(
    "hosting-deploy",
    "secrets/export",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        environment,
      }),
    },
  );
  return result.secrets;
}

// Logs API (proxies to Google Cloud Logging)

export interface LogEntry {
  timestamp: string;
  severity: string;
  message: string;
  insertId: string;
  labels?: Record<string, string>;
}

export interface LogsResponse {
  logs: LogEntry[];
  nextPageToken?: string;
  source: "cloud_logging";
  error_code?: string;
  message?: string;
}

export interface ListLogsOptions {
  deploymentId?: string;
  type?: "build" | "runtime" | "bridge";
  severity?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  since?: string;
  limit?: number;
  pageToken?: string;
}

export async function listLogs(
  serverId: string,
  options: ListLogsOptions = {},
): Promise<LogsResponse> {
  const params = new URLSearchParams({ server_id: serverId });

  if (options.deploymentId) {
    params.set("deployment_id", options.deploymentId);
  }
  if (options.type) {
    params.set("type", options.type);
  }
  if (options.severity) {
    params.set("severity", options.severity);
  }
  if (options.since) {
    params.set("since", options.since);
  }
  if (options.limit) {
    params.set("limit", options.limit.toString());
  }
  if (options.pageToken) {
    params.set("page_token", options.pageToken);
  }

  return edgeFunctionRequest<LogsResponse>(
    "hosting-deploy",
    `logs?${params.toString()}`,
    { method: "GET" },
  );
}

// Server Status API

export interface DeploymentInfo {
  id: string;
  status: string;
  git_sha: string | null;
  git_branch: string | null;
  git_author: string | null;
  git_message: string | null;
  service_url: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ServerStatusResponse {
  server: {
    id: string;
    name: string;
    slug: string;
    status: string;
    hosting_url: string | null;
    health_status: string | null;
    last_health_check: string | null;
  };
  deployments: DeploymentInfo[];
  stats: {
    total_deployments: number;
    successful_deployments: number;
    failed_deployments: number;
    secrets_count: number;
  };
}

export async function getServerStatus(
  serverId: string,
): Promise<ServerStatusResponse> {
  return edgeFunctionRequest<ServerStatusResponse>(
    "hosting-deploy",
    `server-status?server_id=${encodeURIComponent(serverId)}`,
    { method: "GET" },
  );
}

// ============================================
// AI Generation APIs
// ============================================

export interface GeneratedPlan {
  name: string;
  type: "fixed" | "usage" | "hybrid";
  description: string;
  price_monthly: number;
  price_yearly: number | null;
  usage_price: number | null;
  quota_requests: number | null;
  quota_tokens: number | null;
  quota_type: "monthly" | "daily" | "unlimited";
  rate_limit_value: number | null;
  rate_limit_unit: "second" | "minute" | "hour" | "day" | null;
  is_recommended: boolean;
  require_approval: boolean;
  status: string;
}

export interface GeneratePlansResponse {
  plans: GeneratedPlan[];
}

export async function generatePlans(
  serverName: string,
  userInput: string,
): Promise<GeneratePlansResponse> {
  return edgeFunctionRequest<GeneratePlansResponse>("generate-plans", "", {
    method: "POST",
    body: JSON.stringify({
      serverName,
      userInput,
      isPrivate: false,
    }),
  });
}

// Response from generate-seo edge function (camelCase from OpenAI)
export interface GenerateSEORawResponse {
  displayName: string;
  category: string;
  description: string;
  longDescription: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
}

// Normalized SEO interface used by CLI (snake_case)
export interface GeneratedSEO {
  display_name: string;
  category: string;
  short_description: string;
  long_description: string;
  tags: string[];
}

export async function generateSEO(
  serverName: string,
  description: string,
  tags?: string[],
): Promise<GeneratedSEO> {
  const raw = await edgeFunctionRequest<GenerateSEORawResponse>(
    "generate-seo",
    "",
    {
      method: "POST",
      body: JSON.stringify({
        serverName,
        description,
        tags,
      }),
    },
  );

  // Normalize camelCase response to snake_case
  return {
    display_name: raw.displayName,
    category: raw.category,
    short_description: raw.description,
    long_description: raw.longDescription,
    tags: raw.tags,
  };
}

export async function savePlans(
  serverId: string,
  plans: GeneratedPlan[],
): Promise<{ success: boolean }> {
  return edgeFunctionRequest<{ success: boolean }>(
    "hosting-deploy",
    "update-server/plans",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        plans,
      }),
    },
  );
}

export interface SaveSEORequest {
  display_name?: string;
  category?: string;
  short_description?: string;
  long_description?: string;
  tags?: string[];
}

export async function saveSEO(
  serverId: string,
  seo: SaveSEORequest,
): Promise<{ success: boolean }> {
  return edgeFunctionRequest<{ success: boolean }>(
    "hosting-deploy",
    "update-server",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_id: serverId,
        ...seo,
      }),
    },
  );
}

export interface ServerSetupStatus {
  hasPlans: boolean;
  hasSEO: boolean;
  planCount: number;
}

export async function getServerSetupStatus(
  serverId: string,
): Promise<ServerSetupStatus> {
  return edgeFunctionRequest<ServerSetupStatus>(
    "hosting-deploy",
    `setup-status?server_id=${encodeURIComponent(serverId)}`,
    { method: "GET" },
  );
}

export interface DiscoverCapabilitiesResult {
  success: boolean;
  discovered: {
    tools: { name: string; description?: string }[];
    resources: { uri: string; name?: string }[];
    prompts: { name: string; description?: string }[];
  };
  capabilities: {
    protocolVersion: string;
    serverInfo: { name: string; version: string };
    supportsSSE: boolean;
  };
  message?: string;
}

/**
 * Discover MCP server capabilities (tools, resources, prompts)
 * Called after successful deploy to populate the API tab
 */
export async function discoverCapabilities(
  serverId: string,
): Promise<DiscoverCapabilitiesResult> {
  return edgeFunctionRequest<DiscoverCapabilitiesResult>("mcp-discover", "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      server_id: serverId,
      skip_auth: true, // Hosted servers don't need auth for discovery
    }),
  });
}

// ============================================
// Rollback API
// ============================================

export interface RollbackOptions {
  targetDeploymentId?: string;
  steps?: number;
  reason?: string;
}

export interface RollbackResponse {
  success: boolean;
  deployment_id: string;
  rolled_back_from: string;
  rolled_back_to: string;
  service_url?: string;
}

/**
 * Rollback to a previous deployment
 */
export async function rollbackDeployment(
  serverId: string,
  options: RollbackOptions = {},
): Promise<RollbackResponse> {
  return edgeFunctionRequest<RollbackResponse>("hosting-deploy", "rollback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      server_id: serverId,
      target_deployment_id: options.targetDeploymentId,
      steps: options.steps,
      reason: options.reason,
    }),
  });
}

// ============================================
// Delete Server API
// ============================================

export interface DeleteServerResponse {
  success: boolean;
  message: string;
}

/**
 * Delete an MCP server permanently
 */
export async function deleteServer(
  serverId: string,
): Promise<DeleteServerResponse> {
  return edgeFunctionRequest<DeleteServerResponse>(
    "hosting-deploy",
    "servers",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_id: serverId }),
    },
  );
}

// ============================================
// Analyze Project API
// ============================================

/**
 * Analyze a project tarball and generate mcpize.yaml
 * No authentication required - just project analysis
 *
 * @param tarball - Gzipped tarball of the project
 * @param projectName - Optional project name for the generated manifest
 * @returns mcpize.yaml content as string
 */
export async function analyzeProject(
  tarball: Buffer,
  projectName?: string,
): Promise<string> {
  const baseUrl = getFunctionsUrl();
  const queryParams = projectName ? `?name=${encodeURIComponent(projectName)}` : "";
  const url = `${baseUrl}/analyze-repository/tarball${queryParams}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/gzip",
    },
    body: tarball,
  });

  if (!response.ok) {
    let errorMessage: string;
    try {
      const body = (await response.json()) as { error?: string };
      errorMessage = body.error || `Analysis failed: ${response.status}`;
    } catch {
      errorMessage = `Analysis failed: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return response.text();
}
