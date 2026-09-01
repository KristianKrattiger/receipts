import type { AnchorTag } from "../types.js"

/**
 * Cap on an admitted quote. Enforced here rather than in the prompt so it
 * cannot be argued around: short attributed excerpts with a link back, never
 * wholesale republication of a fetched page.
 */
export const MAX_QUOTE_WORDS = 40

export type AnchorResult =
  | { ok: true; start: number; end: number; tag: AnchorTag }
  | { ok: false; code: "ANCHOR_NOT_FOUND" | "QUOTE_TOO_LONG" }

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Re-derive a quote's position from the bytes we fetched.
 *
 * Exact substring match only — no fuzzy matching, no normalization, no
 * trimming. That strictness is the guarantee: a quote the model invented,
 * paraphrased, or "tidied" cannot anchor, so it never reaches the report.
 *
 * A quote occurring more than once is tagged AMBIGUOUS rather than resolved to
 * an arbitrary occurrence.
 */
export function findAnchor(text: string, quote: string): AnchorResult {
  if (quote.length === 0) return { ok: false, code: "ANCHOR_NOT_FOUND" }
  if (wordCount(quote) > MAX_QUOTE_WORDS) return { ok: false, code: "QUOTE_TOO_LONG" }

  const first = text.indexOf(quote)
  if (first === -1) return { ok: false, code: "ANCHOR_NOT_FOUND" }

  const second = text.indexOf(quote, first + 1)
  return {
    ok: true,
    start: first,
    end: first + quote.length,
    tag: second === -1 ? "EXACT" : "AMBIGUOUS",
  }
}
