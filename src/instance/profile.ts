import type { FieldProfile } from "../assay/types.js"
import { SMALL_SYSTEM } from "./prompt-small.js"

/**
 * Receipts: a vendor's live web claims against independent web sources.
 *
 * `receipts(tier)` returns the field profile for a proposer tier. The lexicon
 * and retrieval policy are the same for both; only the system prompt differs.
 */
export type PromptTier = "frontier" | "small"
export const PROMPT_TIERS: readonly PromptTier[] = ["frontier", "small"]

// The string the engine shipped as its default until the field profile
// existed, byte for byte — the Tesla proposal cache keys on it.
const FRONTIER_SYSTEM = `You compare a vendor's own claims against independent reports about that vendor.

You receive excerpts, each tagged with a docId and a role:
  claimant  the vendor's own marketing, docs, pricing, or changelog
  independent   status pages, review sites, forums

Propose relations between excerpts:
  contradicts   a vendor claim an independent source contradicts
  corroborates  a vendor claim an independent source confirms
  updates       an independent source reports a newer state than the vendor claim
  unsupported   a specific, checkable vendor claim no excerpt corroborates (set "to" to null)

Rules:
- "quote" MUST be copied character-for-character from the excerpt. Do not fix
  typos, expand contractions, alter whitespace, or trim punctuation. A quote that
  is not a byte-exact substring of its excerpt is discarded before it reaches the
  report, so an approximate quote is worse than no proposal.
- Keep every quote to 40 words or fewer. Quote the specific claim, not the paragraph.
- A quote must lie on ONE line. Excerpt text is rendered page text, so a line
  break is a layout edge -- a stat tile, a table cell, a heading, a nav item.
  Quoting across one stitches unrelated fragments into a sentence the source
  never wrote: "7x\\nSafer\\nThan a Human Driver" is three tiles of a graphic,
  not a claim. Such quotes are discarded. If the only version of a claim you can
  find spans a line break, skip it and quote a prose sentence instead.
- A quote must stand on its own as a claim. Include the subject: "7x safer than a
  human driver", not "than a human driver". A bare number like "14,063,269,987" is
  not a claim -- quote "14 billion miles driven" or nothing. Fragments are discarded.
- A name is not a claim. "Full Self-Driving (Supervised)" and "Claude Sonnet 5" name
  a product; they assert nothing. If the claim is that the product exists, costs
  $99/mo, or is available somewhere, quote the words that say so -- "Available for
  $99/mo", "is currently available in select markets". Quote the predicate, not the
  subject. Bare names are discarded.
- For contradicts, corroborates, and updates, "from" must be a claimant
  excerpt and "to" an independent excerpt.
- "statement" is a short neutral label for the claim, e.g. "uptime guarantee".
- Only call a vendor claim unsupported if it makes a specific checkable
  assertion. Vague marketing adjectives are not claims.
- An aggregator is a conduit, not a source. A Hacker News or Reddit result whose
  link points back at the vendor's own domain is the vendor's announcement posted
  elsewhere, NOT independent corroboration. Do not offer it as one; such proposals
  are discarded. A third-party write-up, benchmark or incident report is what
  counts, as is an independent commenter's own words.
- "confidence" is 0 to 1, and it measures ONE thing: how certain you are that the
  two quotes, exactly as written, stand in the relation you are claiming. It is
  not how likely the underlying claim is to be true, not how serious or
  newsworthy the finding is, and not how confident you are that the source is
  reliable. A small, dull, precisely-worded contradiction is high confidence.
  Calibrate against these:
    0.95  the quotes state opposing (or matching) things outright; no reading in
    0.80  the relation holds, but depends on context around the quotes
    0.60  the quotes are about the same thing and point that way, arguably
    0.30  the quotes are about adjacent topics and the link is inference
  Use the whole range and use precise values. Do not cluster on one number.`

const SYSTEM: Record<PromptTier, string> = { frontier: FRONTIER_SYSTEM, small: SMALL_SYSTEM }

// The lexicon is a first draft. `holding` marks a source committing to its
// own test or measurement; `argument` marks attributed hearsay. It is closed
// and extractive like Claim/Record's, and corrected through
// src/instance/calibration/, not by inference at run time.
const LEXICON = {
  holding: /\b(?:we|our team) (?:tested|measured|benchmarked|confirmed|observed|verified)\b|\bour (?:tests?|testing|measurements?|benchmarks?) (?:found|show(?:ed)?|confirm(?:ed)?)\b|\bin our (?:tests?|testing|benchmarks?)\b|\baccording to our (?:tests?|testing|measurements?|benchmarks?)\b/i,
  issue: /(?!)/,
  argument: /\bcritics (?:argue|say|claim)\b|\bproponents (?:argue|say|claim)\b|\bsome (?:say|argue|claim)\b|\breportedly\b|\ballegedly\b|\baccording to\b/i,
}

const RETRIEVAL = { queryTerms: "subject" as const, pinEnds: false }

/**
 * Receipts' field profile for a proposer tier. Lexicon and retrieval are the
 * same either way; only the system prompt differs, and it is part of the
 * proposal cache key, so the two tiers never read each other's responses.
 */
export function receipts(tier: PromptTier): FieldProfile {
  return { name: "receipts", system: SYSTEM[tier], lexicon: LEXICON, retrieval: RETRIEVAL }
}

/**
 * Resolve an on-disk tier string (from a manifest, untyped since it came
 * from JSON) to this instance's field profile, or `undefined` when this
 * instance has no such tier. The one resolver every entry point shares.
 */
export function receiptsFor(tier: string): FieldProfile | undefined {
  return (PROMPT_TIERS as readonly string[]).includes(tier) ? receipts(tier as PromptTier) : undefined
}
