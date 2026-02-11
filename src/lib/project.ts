import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface ProjectConfig {
  serverId: string;
  serverName?: string;
  branch?: string;
}

export interface SecretDefinition {
  name: string;
  required: boolean;
  description?: string;
  pattern?: string;
  placeholder?: string;
}

export interface CredentialDefinition extends SecretDefinition {
  docs_url?: string;
  mapping?: {
    env?: string;
    header?: string;
    arg?: string;
  };
}

export interface McpizeManifest {
  version: number;
  name?: string;
  description?: string;
  runtime: "typescript" | "python" | "php" | "container";
  entry?: string;
  pythonModulePath?: string;
  build?: {
    install?: string;
    command?: string;
    dockerfile?: string;
  };
  startCommand?: {
    type: "http" | "sse" | "stdio";
    command?: string;
    args?: string[];
  };
  bridge?: {
    mode: "http" | "sse" | "stdio";
  };
  secrets?: SecretDefinition[];
  credentials?: CredentialDefinition[];
  credentials_mode?: "shared" | "per_user";
  configSchema?: {
    source: "code" | "inline" | "url";
    inline?: unknown;
  };
}

const PROJECT_DIR = ".mcpize";
const PROJECT_FILE = "project.json";

export function getProjectConfigPath(cwd: string): string {
  return join(cwd, PROJECT_DIR, PROJECT_FILE);
}

export function loadProjectConfig(cwd: string): ProjectConfig | null {
  const configPath = getProjectConfigPath(cwd);

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as ProjectConfig;
  } catch {
    return null;
  }
}

export function saveProjectConfig(cwd: string, config: ProjectConfig): void {
  const projectDir = join(cwd, PROJECT_DIR);

  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
  }

  const configPath = getProjectConfigPath(cwd);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function loadManifest(cwd: string): McpizeManifest | null {
  const manifestPath = join(cwd, "mcpize.yaml");

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    return parseYaml(content) as McpizeManifest;
  } catch {
    return null;
  }
}

export function hasManifest(cwd: string): boolean {
  return existsSync(join(cwd, "mcpize.yaml"));
}

export function detectRuntime(
  cwd: string,
): "typescript" | "python" | "php" | null {
  if (existsSync(join(cwd, "package.json"))) {
    return "typescript";
  }
  if (
    existsSync(join(cwd, "requirements.txt")) ||
    existsSync(join(cwd, "pyproject.toml"))
  ) {
    return "python";
  }
  if (existsSync(join(cwd, "composer.json"))) {
    return "php";
  }
  return null;
}

export interface PackageJson {
  name?: string;
  description?: string;
  version?: string;
  main?: string;
  exports?: unknown;
}

export function loadPackageJson(cwd: string): PackageJson | null {
  const packagePath = join(cwd, "package.json");

  if (!existsSync(packagePath)) {
    return null;
  }

  try {
    const content = readFileSync(packagePath, "utf-8");
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}
