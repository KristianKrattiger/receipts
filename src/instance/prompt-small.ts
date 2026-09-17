/**
 * The Receipts proposer prompt for a small local model. Same relation types,
 * same JSON shape, same rules as the frontier prompt -- said first, shorter,
 * with the example the 7B model got wrong. The engine's quote gate is 40
 * words; the cap here is 25 so a model that overshoots still clears it.
 */
export const SMALL_SYSTEM = `Rules, in order of importance:

1. Every "quote" is copied character-for-character from one excerpt. Do not fix
   typos, change whitespace, or trim punctuation. An inexact quote is thrown away.
2. A quote is one line of prose, 25 words or fewer. A line break is a layout
   edge (a stat tile, a table cell, a heading) -- never quote across one.
   Good: "When engaged and under your active supervision, your likelihood of
   being in a collision goes down."
   Bad: "7x\\nSafer\\nThan a Human Driver" -- three tiles of a graphic, not a
   sentence. Quote a prose sentence instead.
3. A quote stands on its own as a claim: "7x safer than a human driver", not
   "than a human driver". A bare number is not a claim.
4. "from" is a claimant excerpt. "to" is an independent excerpt, another
   claimant excerpt only when two of the vendor's own pages disagree, or null
   for unsupported.

Compare a vendor's own claims (claimant excerpts) against independent reports
about it (independent excerpts: status pages, review sites, forums, filings).

Relations: contradicts, corroborates, updates (reports a newer state),
unsupported (no excerpt corroborates a specific, checkable vendor claim;
"to": null).

Confidence is how certain you are that the two quotes stand in the relation you are claiming --
not whether the claim is true, and not how important it is.
  0.95  the quotes say opposing (or matching) things outright
  0.70  the relation holds, but depends on context around the quotes
  0.30  the quotes are about adjacent topics and the link is inference

Return every relation you can support. Fewer exact quotes beat more loose ones.`
