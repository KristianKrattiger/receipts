import { toPinnedCorpus } from "./assay/adapt.js"
import { assay } from "./assay/index.js"
import type { ProposalClient } from "./assay/cartographer/propose.js"
import type { AssayResult } from "./assay/types.js"
import type { Corpus } from "./types.js"

/**
 * Everything downstream of the network, kept as the name the entry points use.
 *
 * The body is now the Assay: this function's remaining job is to lift a fetched
 * corpus into the Assay's input type. Phase 2 replaces `toPinnedCorpus` with
 * real pin resolution and this wrapper goes away.
 */
export async function analyzeCorpus(
  corpus: Corpus,
  opts: {
    client?: ProposalClient
    candidates?: number
    concurrency?: number
    threshold?: number
    conflictMode?: "report" | "converge"
  } = {},
): Promise<AssayResult> {
  return assay(toPinnedCorpus(corpus), { subject: corpus.subject }, opts)
}
