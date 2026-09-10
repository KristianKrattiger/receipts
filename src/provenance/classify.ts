import type { Pin, Stability } from "../assay/types.js"

/**
 * What a document's stability is, before any pin is resolved.
 *
 * Everything defaults to `volatile`. That is the whole of the rule, and the
 * conservative direction: an unclassified stable source is merely
 * under-credited, whereas an unclassified volatile source would be
 * over-credited — a ledger asserting a row rests on something durable when it
 * does not. `stabilityFor` below may promote a document afterwards, but only
 * on evidence.
 */
export function classifyStability(declared: Stability | undefined): Stability {
  return declared ?? "volatile"
}

/**
 * The full precedence between a plan author's declaration and an earned pin:
 * a declaration always wins, and only in its absence does a `permalink` pin
 * promote the document to `stable`. Everything else falls back to
 * `classifyStability`'s default.
 *
 * The property that must hold: an explicit `volatile` declaration beats a
 * permalink pin. The author knows something the URL's shape does not, and
 * silently overriding them would launder an assumption into the ledger.
 *
 * This is the one place that precedence is implemented. It used to be
 * duplicated character-for-character in `assay/adapt.ts` (the live pipeline)
 * and `provenance/backfill.ts` (giving an already-committed report the
 * provenance it predates) — both call this function now, so a later phase
 * cannot add promotion logic to one path and leave the other stale.
 */
export function stabilityFor(declared: Stability | undefined, pin: Pin): Stability {
  return declared ?? (pin.kind === "permalink" ? "stable" : classifyStability(undefined))
}
