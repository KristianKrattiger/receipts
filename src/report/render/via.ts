import type { FetchVia } from "../../types.js"

/**
 * Pure: the provenance suffix a document's label carries.
 *
 * One helper rather than six open-coded suffixes, because each renderer shows a
 * document's label in two separate places -- on a cited row and in the sources
 * listing -- and those drifting apart would mean a ledger that marks a source
 * in one place and not the other.
 *
 * Only `api` is annotated. The browser fan is the default path, and marking it
 * would add noise to every row of every ledger this project has published.
 */
export function viaSuffix(via: FetchVia | undefined): string {
  return via === "api" ? " (via api)" : ""
}

/**
 * `admit.ts` formats a denial's detail as `${confidence} — ${topic}: ${statement}`
 * (see `src/assay/bookkeeper/admit.ts`), so a `Refusal.nearMiss` entry's
 * `statement` already opens with the same confidence number every renderer
 * also prints beside it via `confidence.toFixed(2)`. Left unstripped, a
 * renderer would show the score twice: "0.42  0.42 — topic: the claim".
 *
 * One helper rather than three copies of the regex, so the three renderers
 * cannot drift on what counts as the prefix.
 *
 * Anchored to the start and applied once: a statement that never carried the
 * prefix passes through untouched, and an em dash inside the claim text
 * itself — past the first token — is left alone.
 */
const CONFIDENCE_PREFIX = /^-?\d+(?:\.\d+)?(?:e[-+]?\d+)? — /

export function stripConfidencePrefix(statement: string): string {
  return statement.replace(CONFIDENCE_PREFIX, "")
}
