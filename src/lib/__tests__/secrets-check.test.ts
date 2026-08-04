import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkRequiredSecrets } from "../validation.js";

// Regression cover for the deploy path that warned "Potentially missing
// secrets: WORKER, TOKEN" on a server where both were already configured.
// The root cause was the caller omitting configuredSecrets, so the check ran
// against an empty set and flagged every env var it found.
let cwd: string;

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), "mcpize-secrets-"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(
    join(cwd, "src", "index.ts"),
    [
      "const worker = process.env.WORKER;",
      "const token = process.env.TOKEN;",
      "const port = process.env.PORT;",
      "export { worker, token, port };",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("checkRequiredSecrets", () => {
  it("flags env vars when nothing is configured", () => {
    const result = checkRequiredSecrets(cwd, "typescript", []);
    expect(result.valid).toBe(false);
    expect(result.missingSecrets.sort()).toEqual(["TOKEN", "WORKER"]);
  });

  it("stays silent once those secrets are configured", () => {
    const result = checkRequiredSecrets(cwd, "typescript", ["WORKER", "TOKEN"]);
    expect(result.missingSecrets).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("matches configured names case-insensitively", () => {
    const result = checkRequiredSecrets(cwd, "typescript", ["worker", "token"]);
    expect(result.missingSecrets).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("reports only the secrets that are genuinely absent", () => {
    const result = checkRequiredSecrets(cwd, "typescript", ["WORKER"]);
    expect(result.missingSecrets).toEqual(["TOKEN"]);
    expect(result.valid).toBe(false);
  });

  it("never flags system env vars such as PORT", () => {
    const result = checkRequiredSecrets(cwd, "typescript", []);
    expect(result.missingSecrets).not.toContain("PORT");
  });
});
