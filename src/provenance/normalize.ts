import { createHash } from "node:crypto"

/**
 * Patterns that change without the page changing.
 *
 * Deliberately conservative, and the bias is one-directional: over-normalizing
 * HIDES a real edit, which is the failure that matters, while under-normalizing
 * only produces a false drift flag that a reader can dismiss. So this strips
 * machine timestamps, relative clocks, and long opaque identifiers — things
 * *unlikely* to be part of a claim — and leaves years, prices, percentages and
 * small counts alone, because those are exactly what a vendor's claims are made
 * of.
 *
 * "Unlikely," not "cannot": the epoch rule below strips some long numerals
 * that ARE the claim. Measured over this repo's own 26 committed snapshots,
 * 5 contain a 10- or 13-digit run that is not a timestamp and gets stripped
 * anyway — most legibly the Vercel Wikipedia article's own citation, "p. 367.
 * ISBN 9781492087489." If that citation were swapped for a different book,
 * the drift hash would not move. That is an accepted residual, not an
 * oversight: a date-plausibility check cannot tell a real epoch value apart
 * from an ISBN or an HN item id, because the entire 10- and 13-digit integer
 * spaces both map to plausible dates.
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
