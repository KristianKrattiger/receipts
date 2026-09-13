import type { AdmitResult } from "../assay/bookkeeper/admit.js"
import { buildLedger, rowStatus } from "../assay/assemble.js"
import type { PinnedCorpus } from "../assay/types.js"
import type { Corpus, Report } from "../types.js"

export { rowStatus }

/**
 * Receipts test helper: a Corpus is a PinnedCorpus with optional pin fields.
 * Assay assemble uses `buildLedger` directly.
 */
export function buildReport(
  corpus: Corpus,
  proposed: number,
  result: AdmitResult,
  opts: { passes?: number } = {},
): Report {
  return buildLedger(corpus as unknown as PinnedCorpus, proposed, result, opts)
}
