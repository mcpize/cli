import { describe, it, expect } from "vitest";
import {
  X402PricingSchema,
  ZERO_ADDRESS,
  isValidEIP55Checksum,
  validatePriceDecimal6,
} from "../x402-pricing.js";

// Canonical EIP-55 test vector from https://eips.ethereum.org/EIPS/eip-55.
// Identical to the address used in the mcpize server-side tests so the two
// suites stay aligned.
const VALID_EIP55 = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";

function basePricing(overrides: Record<string, unknown> = {}) {
  return {
    protocol: "x402",
    network: "base",
    recipient: VALID_EIP55,
    asset: "usdc",
    tools: [{ name: "search", price: "0.01" }],
    ...overrides,
  };
}

describe("X402PricingSchema -- happy paths", () => {
  it("accepts a minimal valid pricing object", () => {
    expect(X402PricingSchema.safeParse(basePricing()).success).toBe(true);
  });

  it("accepts a tool with optional description present", () => {
    const tools = [{ name: "search", price: "0.05", description: "Find things" }];
    expect(X402PricingSchema.safeParse(basePricing({ tools })).success).toBe(true);
  });

  it("accepts a tool with optional description omitted", () => {
    const tools = [{ name: "search", price: "0.05" }];
    expect(X402PricingSchema.safeParse(basePricing({ tools })).success).toBe(true);
  });

  it("accepts both supported networks", () => {
    expect(
      X402PricingSchema.safeParse(basePricing({ network: "base" })).success,
    ).toBe(true);
    expect(
      X402PricingSchema.safeParse(basePricing({ network: "base-sepolia" })).success,
    ).toBe(true);
  });
});

describe("X402PricingSchema -- rejection cases", () => {
  it("rejects the zero address as recipient", () => {
    const r = X402PricingSchema.safeParse(basePricing({ recipient: ZERO_ADDRESS }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /zero address/i.test(i.message))).toBe(true);
    }
  });

  it("rejects all-lowercase form of a valid EIP-55 address", () => {
    const r = X402PricingSchema.safeParse(
      basePricing({ recipient: VALID_EIP55.toLowerCase() }),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /eip-55/i.test(i.message))).toBe(true);
    }
  });

  it("rejects an unknown network", () => {
    const r = X402PricingSchema.safeParse(basePricing({ network: "ethereum" }));
    expect(r.success).toBe(false);
  });

  it("rejects an unsupported asset", () => {
    const r = X402PricingSchema.safeParse(basePricing({ asset: "eth" }));
    expect(r.success).toBe(false);
  });

  it("rejects an empty tools array", () => {
    const r = X402PricingSchema.safeParse(basePricing({ tools: [] }));
    expect(r.success).toBe(false);
  });

  it("rejects price > 100", () => {
    const tools = [{ name: "search", price: "100.01" }];
    const r = X402PricingSchema.safeParse(basePricing({ tools }));
    expect(r.success).toBe(false);
  });

  it("rejects duplicate tool names", () => {
    const tools = [
      { name: "search", price: "0.01" },
      { name: "search", price: "0.02" },
    ];
    const r = X402PricingSchema.safeParse(basePricing({ tools }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /duplicate/i.test(i.message))).toBe(true);
    }
  });
});

describe("helper unit tests", () => {
  it("isValidEIP55Checksum accepts the canonical Vitalik example", () => {
    expect(isValidEIP55Checksum(VALID_EIP55)).toBe(true);
  });

  it("isValidEIP55Checksum rejects all-lowercase / all-uppercase forms", () => {
    expect(isValidEIP55Checksum(VALID_EIP55.toLowerCase())).toBe(false);
    const upper = "0x" + VALID_EIP55.slice(2).toUpperCase();
    expect(isValidEIP55Checksum(upper)).toBe(false);
  });

  it("validatePriceDecimal6 enforces the [0.01, 100] range", () => {
    expect(validatePriceDecimal6("0.01")).toBe(true);
    expect(validatePriceDecimal6("100")).toBe(true);
    expect(validatePriceDecimal6("0")).toBe(false);
    expect(validatePriceDecimal6("0.001")).toBe(false);
    expect(validatePriceDecimal6("100.01")).toBe(false);
    expect(validatePriceDecimal6("-1")).toBe(false);
    expect(validatePriceDecimal6("abc")).toBe(false);
  });
});
