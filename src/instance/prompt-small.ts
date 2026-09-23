/**
 * The Receipts proposer prompt for a small local model. Same relation types,
 * same JSON shape, same rules as the frontier prompt -- said first, shorter,
 * with the example the 7B model got wrong. The engine's quote gate is 40
 * words; the cap here is 25 so a model that overshoots still clears it.
 */
export const SMALL_SYSTEM = `Rules, in order of importance:

1. Every "quote" is copied character-for-character from one excerpt. Do not fix
   typos, change whitespace, or trim punctuation. An inexact quote is thrown away.
2. A quote is one line of prose, 25 words or fewer. A line break inside it
   means a heading stacked above a number, or a stat tile -- not a sentence.
   Find the nearby prose sentence that says the same thing and quote that.
   Good: "When engaged and under your active supervision, your likelihood of being in a collision goes down."
3. A quote stands on its own as a claim: not a sentence fragment, not a bare
   number, not a product name. Quote the words that say what it does.
4. "from" is a claimant excerpt. "to" is an independent excerpt, or null for
   unsupported. Copy each excerpt's docId exactly.

Relations: contradicts, corroborates, updates (an independent excerpt reports
a newer state than the vendor claim), unsupported (no excerpt corroborates a
specific, checkable vendor claim; "to": null). "statement" is a short neutral
label for the claim, e.g. "uptime guarantee" -- not the quote, not a verdict.

Confidence is how certain you are that the two quotes stand in the relation you are claiming --
not whether the claim is true, and not how important it is.
  0.95  the quotes say opposing (or matching) things outright
  0.70  the relation holds, but depends on context around the quotes
  0.30  the quotes are about adjacent topics and the link is inference
Use values in between when they fit. Do not cluster on one number.

Return every relation you can support.`
