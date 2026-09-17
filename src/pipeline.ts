import { toPinnedCorpus } from "./provenance/adapt.js"
import { assay } from "./assay/index.js"
import type { ProposalClient } from "./assay/cartographer/propose.js"
import type { AssayResult, FieldProfile } from "./assay/types.js"
import { defaultClient, toAssayClient } from "./cartographer/anthropic.js"
import { receipts } from "./instance/profile.js"
import type { Corpus } from "./types.js"

/**
 * Everything downstream of the network, kept as the name the entry points use.
 *
 * The body is now the Assay: this function's remaining job is to lift a fetched
 * corpus into the Assay's input type. Real pin resolution lives in
 * `toPinnedCorpus`; this wrapper stayed.
 */
export async function analyzeCorpus(
  corpus: Corpus,
  opts: {
    client?: ProposalClient
    clientForSample?: (sample: number) => ProposalClient
    candidates?: number
    concurrency?: number
    threshold?: number
    conflictMode?: "report" | "converge"
    runs?: 1 | 2
    stabilityViolated?: Set<string>
    /** Whether a content hash is already committed to the snapshot store. */
    isStored?: (sha256: string) => boolean
    /** The field profile to analyse under. Defaults to Receipts' frontier prompt. */
    profile?: FieldProfile
  } = {},
): Promise<AssayResult> {
  const { isStored, profile, ...assayOpts } = opts
  return assay(
    toPinnedCorpus(corpus, isStored ? { isStored } : {}),
    { subject: corpus.subject },
    {
      ...assayOpts,
      client: assayOpts.client ?? toAssayClient(defaultClient()),
      profile: profile ?? receipts("frontier"),
      onPassFailure: (f) => console.error(`  pass ${f.passId} failed: ${f.message}`),
    },
  )
}
