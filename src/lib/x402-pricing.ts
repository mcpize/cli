/**
 * x402 Pricing Schema -- DUPLICATE OF mcpize server SSOT
 *
 * ⚠️ This file MUST stay in sync with:
 *    mcpize/supabase/functions/_shared/x402-pricing.ts
 *
 * When updating: change both files in lockstep. Future work tracked as
 * "publish @mcpize/x402-schema npm package" to eliminate this duplication.
 *
 * Last synced from mcpize@b8789e896adb5c29a6986680e22604ba1b5f508e
 *
 * Runtime differences vs SSOT:
 *   - SSOT uses Deno `npm:zod@3.24.0` + `npm:@noble/hashes@2.2.0/sha3.js`.
 *   - This file is Node + ESM, so imports are plain `zod` (4.x) and
 *     `@noble/hashes/sha3.js`. The schema API used here works on both Zod 3 and 4.
 *
 * Spec: docs-specs/x402/implementation-plan.md Phase 0 + Phase 1b
 */

import { z } from "zod";
import { keccak_256 } from "@noble/hashes/sha3.js";

/** All-zeros address. Reject as recipient — funds would be burned. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// TODO(V2): forbid platform treasury address (MCPIZE_TREASURY_ADDR refine).
//           Treasury wallet is not provisioned yet; add when V2 take-rate splits ship.

/**
 * EIP-55 mixed-case checksum validator.
 *
 * Algorithm (https://eips.ethereum.org/EIPS/eip-55):
 *   1. Lowercase the hex portion of the address.
 *   2. Compute keccak256 of the lowercase hex string (as ASCII bytes), no `0x` prefix.
 *   3. For each char in the address: if it's a letter (a-f) and the matching nibble
 *      of the hash is >= 8, it must be uppercase; otherwise lowercase.
 *   4. Digits (0-9) are unaffected.
 *
 * Returns true iff the input's casing matches the EIP-55-derived casing.
 * Pure-lowercase or pure-uppercase forms (other than the rare case where the
 * EIP-55 form is itself all-lowercase by coincidence) are rejected.
 */
export function isValidEIP55Checksum(addr: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return false;
  const hex = addr.slice(2);
  const lower = hex.toLowerCase();
  // ASCII bytes of the lowercase hex string
  const bytes = new TextEncoder().encode(lower);
  const hash = keccak_256(bytes);
  // Convert hash to a hex string; we need each nibble individually.
  let hashHex = "";
  for (const b of hash) {
    hashHex += b.toString(16).padStart(2, "0");
  }
  let expected = "";
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch >= "0" && ch <= "9") {
      expected += ch;
    } else {
      // Letter a-f. Uppercase iff hash nibble at same index >= 8.
      const nibble = parseInt(hashHex[i], 16);
      expected += nibble >= 8 ? ch.toUpperCase() : ch;
    }
  }
  return hex === expected;
}

/**
 * Decimal price validator for USDC (6 decimals).
 *
 * Constraints:
 *   - Bounded form: at most 3 integer digits and up to 6 fractional digits.
 *   - No leading zeros on integer portion (except `0.xxx`).
 *   - Numeric value in [0.01, 100].
 */
export function validatePriceDecimal6(s: string): boolean {
  // Reject "0", "00", "0.0", "0.00", etc. (zero values) and bad shapes early.
  // Pattern: 1-3 digits (no leading zero unless single "0" followed by ".") + optional .1-6 decimals
  if (!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$/.test(s)) return false;
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  return n >= 0.01 && n <= 100;
}

const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const ToolSchema = z.object({
  name: z.string().regex(TOOL_NAME_RE, "Invalid tool name"),
  price: z
    .string()
    .refine(validatePriceDecimal6, "Price must be 0.01–100 USDC, max 6 decimals"),
  description: z.string().max(500).optional(),
});

export const X402PricingSchema = z.object({
  protocol: z.literal("x402"),
  network: z.enum(["base", "base-sepolia"]),
  recipient: z
    .string()
    .regex(ADDRESS_RE, "Recipient must be a 20-byte hex address (0x + 40 hex chars)")
    .refine(
      (addr) => addr.toLowerCase() !== ZERO_ADDRESS,
      "Recipient cannot be the zero address",
    )
    .refine(isValidEIP55Checksum, "Recipient must use EIP-55 checksum casing"),
  asset: z.literal("usdc"),
  tools: z
    .array(ToolSchema)
    .min(1, "At least one tool required")
    .max(200, "At most 200 tools allowed")
    .refine(
      (tools) => new Set(tools.map((t) => t.name)).size === tools.length,
      "Duplicate tool names",
    ),
});

export type X402Pricing = z.infer<typeof X402PricingSchema>;
