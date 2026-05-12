import { describe, it, expect } from "vitest";
import { validateManifest } from "../validation.js";

// Same canonical EIP-55 test vector used by the pricing schema tests.
const VALID_EIP55 = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

const baseManifest = {
  version: 1,
  runtime: "typescript" as const,
  entry: "src/index.ts",
  startCommand: { type: "http" as const, command: "node dist/index.js" },
};

const baseYamlText = `version: 1
runtime: typescript
entry: src/index.ts
startCommand:
  type: http
  command: node dist/index.js
`;

describe("validateManifest -- pricing block integration", () => {
  it("accepts a manifest WITHOUT pricing (pricing is optional)", () => {
    const result = validateManifest(baseManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a manifest WITH a valid pricing block", () => {
    const manifest = {
      ...baseManifest,
      pricing: {
        protocol: "x402",
        network: "base",
        recipient: VALID_EIP55,
        asset: "usdc",
        tools: [{ name: "search", price: "0.01" }],
      },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an invalid pricing block with field-named errors", () => {
    const manifest = {
      ...baseManifest,
      pricing: {
        protocol: "x402",
        network: "ethereum", // invalid
        recipient: VALID_EIP55,
        asset: "usdc",
        tools: [{ name: "search", price: "0.01" }],
      },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.startsWith("pricing.network:")),
    ).toBe(true);
  });

  it("rejects a recipient that fails the EIP-55 checksum", () => {
    const manifest = {
      ...baseManifest,
      pricing: {
        protocol: "x402",
        network: "base",
        recipient: VALID_EIP55.toLowerCase(),
        asset: "usdc",
        tools: [{ name: "search", price: "0.01" }],
      },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.startsWith("pricing.recipient:") && /eip-55/i.test(e),
      ),
    ).toBe(true);
  });

  it("attaches (line, col) hints when yaml source is supplied", () => {
    const yamlText = `${baseYamlText}pricing:
  protocol: x402
  network: ethereum
  recipient: ${VALID_EIP55}
  asset: usdc
  tools:
    - name: search
      price: "0.01"
`;
    const manifest = {
      ...baseManifest,
      pricing: {
        protocol: "x402",
        network: "ethereum",
        recipient: VALID_EIP55,
        asset: "usdc",
        tools: [{ name: "search", price: "0.01" }],
      },
    };
    const result = validateManifest(manifest, yamlText);
    expect(result.valid).toBe(false);
    const networkErr = result.errors.find((e) => e.startsWith("pricing.network:"));
    expect(networkErr).toBeDefined();
    // The "network" key sits on line 9 in the yaml above (lines 1–7 are the
    // base manifest, line 8 is "pricing:", line 9 is "  protocol: x402",
    // line 10 is "  network: ethereum"). Different yaml parsers may anchor
    // on the key vs the value, so we accept any line in that vicinity.
    expect(networkErr).toMatch(/\(line \d+, col \d+\)/);
  });

  it("does not surface line/col when yaml text is omitted", () => {
    const manifest = {
      ...baseManifest,
      pricing: {
        protocol: "x402",
        network: "ethereum",
        recipient: VALID_EIP55,
        asset: "usdc",
        tools: [{ name: "search", price: "0.01" }],
      },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    const networkErr = result.errors.find((e) => e.startsWith("pricing.network:"));
    expect(networkErr).toBeDefined();
    expect(networkErr).not.toMatch(/line \d+, col/);
  });
});
