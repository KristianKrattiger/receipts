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
