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

/**
 * A newline inside a quote means the span crossed a layout boundary.
 *
 * Fetched text comes from `innerText`, which reflects rendering: a flowing
 * paragraph arrives as one line no matter how it wrapped on screen, so a `\n`
 * is a block edge — a stat-grid cell, a list item, a pricing-table column, a
 * nav entry. Stitching across one produces a span that is byte-exact and still
 * not a sentence: "7x\nSafer\nThan a Human Driver When FSD (Supervised) Is
 * Engaged" is three tiles of a graphic, and "Service Requests\nBeta\n1M
 * requests / month included" is four cells of a pricing table. Both anchor, and
 * both render as though the vendor wrote them as a claim.
 *
 * Rejecting is the honest fix. Collapsing the newlines at render time would
 * make the same span *look* like prose the vendor never wrote, which is the
 * failure this gate exists to prevent.
 *
 * The rule earns its keep a second way, on text that never came from a
 * renderer. Reddit documents are built by joining posts with newlines, so this
 * same check is what stops a quote stitching two separate posts -- written by
 * different people, about different things -- into one apparent statement.
 * Do not relax it to "only applies to browser text": it is load-bearing for
 * both.
 */
const CROSSES_BLOCK_BOUNDARY = /\n/

/**
 * Longest run of words still readable as a name rather than a statement.
 * Past this, a title-case run is a headline — "Vercel Confirms Breach As
 * Hackers Claim To Be Selling Stolen Data" asserts something, and rejecting it
 * would cost a real finding.
 */
const MAX_NAME_WORDS = 5

/**
 * Whether a span is a bare name: a product, a heading, a nav label.
 *
 * "Full Self-Driving (Supervised)" and "Claude Sonnet 5" are exact substrings
 * that anchor cleanly and say nothing. Rendered under a claim, they read as
 * though the vendor asserted something, when the sentence around them was the
 * assertion and the model kept only the noun.
 *
 * The test is capitalisation, not part of speech. Requiring a verb would be the
 * obvious rule and the wrong one: "Available for $99/mo" carries no verb and is
 * a genuine pricing claim, and a Japanese span carries no English at all. What
 * separates a name from a statement is that a statement almost always contains
 * a lowercase-initial word — an article, a preposition, an auxiliary. A short
 * run where every cased word is capitalised is a label.
 *
 * Scripts without case are exempt rather than guessed at: with no capital to
 * inspect the rule has no evidence, and silently dropping non-Latin quotes
 * would be a worse failure than admitting a ragged one.
 */
export function isBareName(quote: string): boolean {
  const words = quote.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > MAX_NAME_WORDS) return false

  let sawCasedWord = false
  for (const word of words) {
    // First letter anywhere in the token, so "(Supervised)" is judged on "S".
    const letter = word.match(/\p{L}/u)?.[0]
    if (letter === undefined) continue
    if (letter.toLowerCase() === letter.toUpperCase()) continue // caseless script
    sawCasedWord = true
    if (letter !== letter.toUpperCase()) return false // a lowercase word: a statement
  }
  return sawCasedWord
}

function firstWord(quote: string): string {
  const stripped = quote.trim().replace(/^["'“‘([{\s]+/, "")
  const m = stripped.match(/^[\p{L}\p{N}']+/u)
  return m ? m[0].toLowerCase() : ""
}

/**
 * Whether a verbatim span reads as a self-contained claim.
 *
 * The gate proves a quote is present in the source. It does not, on its own,
 * prove the quote *says* anything: "14,063,269,987", "Than a Human Driver When
 * FSD (Supervised) Is Engaged5", "7x\nSafer\nThan a Human Driver" and
 * "Full Self-Driving (Supervised)" are all exact substrings, and every one of
 * them renders as evidence for a claim it does not carry — a bare number, a
 * chopped tail, three tiles of a graphic, a product name. This is the missing
 * check — kept narrow, because dropping a real short finding is worse here than
 * admitting a slightly ragged one.
 */
export function isCoherentQuote(quote: string): boolean {
  if (!HAS_LETTER.test(quote)) return false
  if (CROSSES_BLOCK_BOUNDARY.test(quote)) return false
  if (SENTENCE_TAIL_OPENERS.has(firstWord(quote))) return false
  if (isBareName(quote)) return false
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
