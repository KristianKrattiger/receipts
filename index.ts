import { admit } from "./bookkeeper/admit.js"
import { proposeAcrossPasses, type ProposalClient } from "./cartographer/propose.js"
import { chunkAll } from "./chunk/chunk.js"
import { buildIdf, tokenize } from "./retrieve/idf.js"
import { selectCandidates } from "./retrieve/select.js"
import { assemble, NOT_ANCHORING_EVIDENCE } from "./assemble.js"
import { DEFAULT_THRESHOLD, type AssayOptions, type AssayQuery, type AssayResult, type PinnedCorpus } from "./types.js"

export type { AssayResult, PinnedCorpus, AssayQuery, AssayOptions } from "./types.js"

/**
 * Documents and a query in; a grounded ledger or a refusal out.
 *
 * Pure given the corpus and the responses of `opts.client`. The Assay never
 * fetches and has no opinion about how a document's pin was obtained.
 */
export async function assay(
  corpus: PinnedCorpus,
  query: AssayQuery,
  opts: AssayOptions & { client?: ProposalClient } = {},
): Promise<AssayResult> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const conflictMode = opts.conflictMode ?? "report"
  const empty = { admitted: [], denied: [] }

  // Structural refusals are decided before the model is called, because the
  // guard exists precisely to stop a run spending money to produce a report
  // where everything is unverified for want of a second side.
  const roles = new Set(corpus.docs.map((d) => d.role))
  if (corpus.docs.length === 0 || roles.size < 2) {
    return assemble(corpus, 0, empty, { conflictMode, anchoredCount: 0 })
  }

  const queryTerms = tokenize(query.subject)
  const idf = buildIdf(corpus.docs)
  const chunks = chunkAll(corpus.docs)

  const total = opts.candidates ?? 40
  const perDoc = Math.max(8, Math.ceil(total / Math.max(corpus.docs.length, 1)))
  const claimantDocIds = new Set(
    corpus.docs.filter((d) => d.role === "claimant").map((d) => d.docId),
  )
  const candidates = selectCandidates(chunks, queryTerms, idf, { perDoc, total, claimantDocIds })

  const fanned = await proposeAcrossPasses(query.subject, corpus.docs, candidates, opts)
  for (const f of fanned.failures) {
    console.error(`  pass ${f.passId} failed: ${f.message}`)
  }

  // Every pass failing is our outage, not a finding about the subject. It stays
  // a thrown error rather than becoming a refusal: a refusal is a statement
  // about the corpus, and this is a statement about us.
  if (fanned.failures.length > 0 && fanned.failures.length === fanned.passes) {
    throw new Error(
      `every proposal pass failed (${fanned.passes}/${fanned.passes}); ` +
        `first: ${fanned.failures[0]!.message}`,
    )
  }

  const result = admit(corpus, fanned.proposals, queryTerms, idf, threshold)

  // See NOT_ANCHORING_EVIDENCE's doc comment in assemble.ts for what each of
  // these codes means and why none of them counts as evidence anchoring ran
  // or succeeded — belowThresholdDetail there relies on the same set, kept in
  // one place so a code cannot end up on the wrong side of one without the
  // other noticing.
  const anchoredCount = result.admitted.length +
    result.denied.filter((d) => !NOT_ANCHORING_EVIDENCE.has(d.code)).length

  return assemble(corpus, fanned.proposals.length, result, {
    conflictMode, anchoredCount, ...(fanned.passes === undefined ? {} : { passes: fanned.passes }),
  })
}
