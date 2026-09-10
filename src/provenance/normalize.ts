import { createHash } from "node:crypto"

/**
 * Patterns that change without the page changing.
 *
 * Deliberately conservative, and the bias is one-directional: over-normalizing
 * HIDES a real edit, which is the failure that matters, while under-normalizing
 * only produces a false drift flag that a reader can dismiss. So this strips
 * only things that cannot be part of a claim — machine timestamps, relative
 * clocks, long opaque identifiers — and leaves years, prices, percentages and
 * small counts alone, because those are exactly what a vendor's claims are made
 * of.
 */
const RULES: { name: string; re: RegExp; token: string }[] = [
  // 2026-09-10T04:12:33.219Z, 2026-09-10T04:12:33+01:00
  { name: "iso8601", token: "<TS>",
    re: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g },
  // "3 hours ago", "41 minutes ago"
  { name: "relative", token: "<AGO>",
    re: /\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi },
  // 32+ hex characters: csrf tokens, session ids, content hashes
  { name: "hexnonce", token: "<HEX>", re: /\b[A-Fa-f0-9]{32,}\b/g },
  // Unix epoch seconds (10 digits) and milliseconds (13). Deliberately NOT a
  // bare length floor: an unformatted claim number ("processed 12000000
  // transactions") is exactly what this tool reads, and stripping it would hide
  // a real edit behind an unchanged driftHash -- the one failure direction this
  // normalizer must not have. A stray 11-digit id surviving only costs a false
  // drift flag, which is the acceptable side of that trade.
  //
  // The lookbehind keeps a decimal fraction intact: `.` is a non-word boundary,
  // so a bare \b would eat the tail of 3.14159265358979.
  { name: "epoch", token: "<TS>", re: /(?<![.\d])(?:\d{13}|\d{10})(?!\d)/g },
]

export function normalizeForDrift(text: string): string {
  let out = text
  for (const rule of RULES) out = out.replace(rule.re, rule.token)
  return out
}

export function driftHashOf(text: string): string {
  return createHash("sha256").update(normalizeForDrift(text), "utf8").digest("hex")
}
