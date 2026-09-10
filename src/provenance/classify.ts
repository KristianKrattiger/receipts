import type { Stability } from "../assay/types.js"

/**
 * What a document's stability is, before any pin is resolved.
 *
 * Everything defaults to `volatile`. That is the whole of the rule, and the
 * conservative direction: an unclassified stable source is merely
 * under-credited, whereas an unclassified volatile source would be
 * over-credited — a ledger asserting a row rests on something durable when it
 * does not. `pin.ts` may promote a document afterwards, but only on evidence.
 */
export function classifyStability(declared: Stability | undefined): Stability {
  return declared ?? "volatile"
}
