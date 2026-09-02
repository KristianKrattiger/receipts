import type { AnchorTag } from "../types.js"

/**
 * Cap on an admitted quote. Enforced here rather than in the prompt so it
 * cannot be argued around: short attributed excerpts with a link back, never
 * wholesale republication of a fetched page.
 */
export const MAX_QUOTE_WORDS = 40

/** A quote must carry at least one letter. A bare number or symbol run is not a claim. */
const HAS_LETTER = /\p{L}/u

/**
 * Words that cannot begin a standalone declarative clause in English. A quote
 * that opens with one of these is the tail of a sentence whose head was cut —
 * "Than a Human Driver When FSD (Supervised) Is Engaged" is a comparison with
 * no subject, produced when innerText flattens a visual stat grid and the model
 * anchors mid-claim. The set is deliberately minimal: only words with no
 * legitimate sentence-initial use, so "When enabled ..." and "And the ..."
 * are untouched.
 */
const SENTENCE_TAIL_OPENERS = new Set(["than", "which", "whom", "whose", "nor"])

function firstWord(quote: string): string {
  const stripped = quote.trim().replace(/^["'“‘([{\s]+/, "")
  const m = stripped.match(/^[\p{L}\p{N}']+/u)
  return m ? m[0].toLowerCase() : ""
}

/**
 * Whether a verbatim span reads as a self-contained claim.
 *
 * The gate proves a quote is present in the source. It does not, on its own,
 * prove the quote *says* anything: "14,063,269,987" and
 * "Than a Human Driver When FSD (Supervised) Is Engaged5" are both exact
 * substrings and both render as evidence for a claim they do not carry. This is
 * the missing check — kept narrow, because dropping a real short finding is
 * worse here than admitting a slightly ragged one.
 */
export function isCoherentQuote(quote: string): boolean {
  if (!HAS_LETTER.test(quote)) return false
  if (SENTENCE_TAIL_OPENERS.has(firstWord(quote))) return false
  return true
}

export type AnchorResult =
  | { ok: true; start: number; end: number; tag: AnchorTag }
  | { ok: false; code: "ANCHOR_NOT_FOUND" | "QUOTE_TOO_LONG" | "INCOHERENT_QUOTE" }

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
  // A span that is a bare number, a punctuation run, or the chopped tail of a
  // sentence is an exact substring but not a claim. Checked before the search,
  // like the length cap: it is a property of the quote, not of where it sits.
  if (!isCoherentQuote(quote)) return { ok: false, code: "INCOHERENT_QUOTE" }
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
